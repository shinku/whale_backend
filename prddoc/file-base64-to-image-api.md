# 图片 base64 转存接口对接文档（/api/file/base64_to_image）

## 1. 接口概述

该接口用于「前端把本地/画布上的图片转成 base64，交给服务端转存成一张真实图片文件」：
调用方传一张图片的 base64，服务端解码后原样上传到 OSS，最后返回可访问的文件名。

与 `base64_to_pdf` / `base64_to_word` 不同，本接口**不做任何识别或格式转换**，
只是把 base64 落成图片文件，因此它是最快、最便宜的一个接口。

| 项 | 说明 |
| --- | --- |
| 请求方式 | `POST` |
| 请求路径 | `/api/file/base64_to_image` |
| Content-Type | `application/json`（请求体是 JSON，非文件流） |
| 鉴权 | 必须携带请求头 `x-user-id`（用户 openid），缺失直接报错 |
| 响应格式 | `application/json; charset=utf-8` |
| 是否流式 | 否，一次性返回结果 |
| 返回内容 | 上传成功后的文件名（不是文件内容） |

> 路径说明：控制器使用 `@Api('/file')` 装饰，实际前缀为 `/api`，因此对外路径是 `/api/file/base64_to_image`。
> 对应源码：`src/controller/file.ts`（`base64ToImage`）、`src/service/OssService.ts`（`uploadStream`）。

## 2. 请求参数

### 2.1 请求头

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | 固定 `application/json` |
| `x-user-id` | 是 | 用户 openid。缺失时报 `{"status":404,"message":"userId is required"}` |

### 2.2 请求体

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `base64` | string | 是 | **单张**图片的 base64，支持带 data URL 前缀 |

校验规则：

- `x-user-id` 缺失 → 报错 `userId is required`。
- `base64` 为空字符串、`null`、`undefined` → 报错 `base64 is empty`。

### 2.3 base64 格式说明

`base64` 可以是下面两种写法，服务端会统一处理：

1. **纯 base64**：`"iVBORw0KGgoAAAANSUhEUg..."`（推荐，体积最小）
2. **data URL**：`"data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..."`（前端 `canvas.toDataURL()` 的原始输出可直接传）

服务端在解码前会自动去掉 `data:xxx;base64,` 前缀，前端无需手动裁剪。

### 2.4 存储位置

上传后的对象名固定为：

```
pub/base64_convert/<时间戳>_<随机数>.png
```

例如 `pub/base64_convert/1728381842163_42.7.png`。

> 注意：**后缀固定为 `.png`**。如果传入的是 jpg/webp 等其它格式，文件名仍会以 `.png` 结尾，
> 但图片的字节内容与格式不会被改动。若需要严格一致的后缀，请自行在上游统一成 PNG 再传。

## 3. 请求示例

### 3.1 curl

```bash
curl -X POST 'http://localhost:7001/api/file/base64_to_image' \
  -H 'Content-Type: application/json' \
  -H 'x-user-id: <用户openid>' \
  -d '{
    "base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..."
  }'
```

### 3.2 前端调用（fetch）

```js
/**
 * @param {string} base64 单张图片 base64，可带 data URL 前缀
 * @returns {Promise<string>} 上传后的文件名，如 "pub/base64_convert/1728381842163_42.7.png"
 */
async function uploadBase64Image(base64) {
  const res = await fetch('/api/file/base64_to_image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': getUserId(), // 用户 openid
    },
    body: JSON.stringify({ base64 }),
  });
  const json = await res.json();
  // 注意：错误时 HTTP 状态码是 500，但 body.status 为 404，需同时判断
  if (!res.ok || json.status !== 200) {
    throw new Error(json.message || '图片上传失败');
  }
  return json.data; // "pub/base64_convert/1728381842163_42.7.png"
}
```

### 3.3 典型用法：从 canvas / 文件生成 base64

```js
// canvas 直接导出（自带 data URL 前缀，可直接传）
const fileName = await uploadBase64Image(canvas.toDataURL('image/png'));

// File -> base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); // 结果带 data URL 前缀
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
const base64 = await fileToBase64(fileInput.files[0]);
const fileName = await uploadBase64Image(base64);
```

## 4. 响应说明

### 4.1 成功响应

```json
{
  "status": 200,
  "data": "pub/base64_convert/1728381842163_42.7.png"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | number | 业务状态码，成功固定为 `200` |
| `data` | string | 图片在 OSS 上的对象名（`pub/` 开头），**不是完整 URL、也不是文件内容** |

拿到 `data` 后如何访问图片：

```js
const fileUrl = `https://fms.whalepea.com/${fileName}`;               // 直链
// 或走后端跳转接口： GET /api/file/get/:bucketname/:filename
const jumpUrl = `/api/file/get/${fileName}`; // => 302 跳转到 fms.whalepea.com
```

> 提示：`data` 已经带 `pub/` 前缀，拼接直链时不要再额外加目录。

### 4.2 异常情况

错误由全局中间件统一包装，**HTTP 状态码为 500，响应体 `status` 为 404**：

```json
{ "status": 404, "message": "<错误信息>" }
```

常见错误信息：

| 场景 | `message` |
| --- | --- |
| 未登录 / 未带 `x-user-id` | `userId is required` |
| `base64` 为空 | `base64 is empty` |
| 上传 OSS 失败 | 由 OSS SDK 抛出的错误信息 |

> 调用方务必同时判断 HTTP `res.ok` 与 `body.status === 200`，不要只看 `body.status`（历史中间件行为）。

## 5. 鉴权与次数限制

- **鉴权**：通过请求头 `x-user-id` 识别用户（openid）。该接口未做 token 校验，公网暴露前需在网关补权限。
- **次数限制**：本接口**不走次数扣减**（无 TextIn 等第三方调用成本）。若后续需要计次，
  可参考 `base64_to_word` 的做法接入 `consumeCountLimit`。

## 6. 注意事项

1. **只做转存**：不做压缩、裁剪、格式转换，上传的字节内容与传入的 base64 解码结果完全一致。
2. **一次一张图**：入参是字符串 `base64`，不是数组。多张图请多次调用。
3. **后缀固定 `.png`**：文件名统一以 `.png` 结尾，不跟随实际图片格式（见 2.4）。
4. **base64 会让请求体显著变大**：base64 相比原图约膨胀 33%。大图请注意网关 / nginx 的
   `client_max_body_size`，必要时先在前端压缩图片。
5. **返回的是文件名而非二进制**：若前端需要直接预览，请自行拼 `https://fms.whalepea.com/${data}`。
6. **同名不覆盖**：上传时设置了 `x-oss-forbid-overwrite: true`，文件名带时间戳与随机数，正常不会冲突。

## 7. 相关接口

- `POST /api/file/base64_to_pdf`：图片 base64 数组 → PDF，见 [`prddoc/file-base64-to-pdf-api.md`](./file-base64-to-pdf-api.md)。
- `POST /api/file/base64_to_word`：单张图片 base64 → Word，见 [`prddoc/file-base64-to-word-api.md`](./file-base64-to-word-api.md)。
- `POST /api/file/expend_2_file`：图片地址（`file_urls`）→ PDF / Word，支持 `to_type=pdf|docx`。
- `POST /api/file/upload`：multipart 文件上传（`@Files`），与本接口功能相近但入参是文件流。
- `GET /api/file/get/:bucketname/:filename`：文件跳转接口，302 到 `https://fms.whalepea.com`。
