# 图片转 Word 接口对接文档（/api/file/base64_to_word）

## 1. 接口概述

该接口用于「前端直接拿着 base64 图片，让服务端识别并转成 Word」：调用方传一张图片的 base64，
服务端把它转成二进制后调用合合信息（TextIn）的 `doc_restore` 接口做识别还原，把生成的
`.docx` 上传到 OSS，最后返回可访问的文件名。

| 项 | 说明 |
| --- | --- |
| 请求方式 | `POST` |
| 请求路径 | `/api/file/base64_to_word` |
| Content-Type | `application/json`（请求体是 JSON，非文件流） |
| 鉴权 | 必须携带请求头 `x-user-id`（用户 openid），缺失直接报错 |
| 响应格式 | `application/json; charset=utf-8` |
| 是否流式 | 否，一次性返回结果 |
| 返回内容 | 上传成功后的文件名（不是文件内容） |

> 路径说明：控制器使用 `@Api('/file')` 装饰，实际前缀为 `/api`，因此对外路径是 `/api/file/base64_to_word`。
> 对应源码：`src/controller/file.ts`（`base64ToWord`）、`src/service/ImageService.ts`（`tiBase64ImageToWord`）。
> 上游接口：`https://api.textin.com/robot/v1.0/api/doc_restore`，参考
> [TextIn 图片转 Word 文档](https://www.textin.com/document/doc_restore)。

## 2. 请求参数

### 2.1 请求头

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | 固定 `application/json`（前端传的是 JSON，服务端内部才转成 `application/octet-stream` 调 TextIn） |
| `x-user-id` | 是 | 用户 openid。缺失时报 `{"status":404,"message":"userId is required"}` |

### 2.2 请求体

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `base64` | string | 是 | **单张**图片的 base64，支持带 data URL 前缀 |
| `lane` | string | 否 | 业务线，默认 `whale`。用于区分次数限制，一般前端不用传 |

校验规则：

- `x-user-id` 缺失 → 报错 `userId is required`。
- `base64` 为空字符串、`null`、`undefined` → 报错 `base64 is empty`。

### 2.3 base64 格式说明

`base64` 可以是下面两种写法，服务端会统一处理：

1. **纯 base64**：`"iVBORw0KGgoAAAANSUhEUg..."`（推荐，体积最小）
2. **data URL**：`"data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..."`（前端 `canvas.toDataURL()` 的原始输出可直接传）

服务端在调用 TextIn 前会自动去掉 `data:xxx;base64,` 前缀，前端无需手动裁剪。

### 2.4 图片要求

- 一次只处理**一张**图片（与 `base64_to_pdf` 的数组入参不同）。
- 单张图片大小不超过 50M。
- 图像宽高需介于 20 ~ 10000 像素之间。
- 支持 jpg / jpeg / png / gif / bmp / webp 等常见格式；格式不支持时 TextIn 会返回实际检测到的类型。

## 3. 请求示例

### 3.1 curl

```bash
curl -X POST 'http://localhost:7001/api/file/base64_to_word' \
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
 * @returns {Promise<string>} 上传后的文件名，如 "pub/1728381842163_42.7.docx"
 */
async function imageToWord(base64) {
  const res = await fetch('/api/file/base64_to_word', {
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
    throw new Error(json.message || '图片转Word失败');
  }
  return json.data; // "pub/1728381842163_42.7.docx"
}
```

### 3.3 典型用法：从 canvas / 文件生成 base64

```js
// canvas 直接导出（自带 data URL 前缀，可直接传）
const fileName = await imageToWord(canvas.toDataURL('image/png'));

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
const fileName = await imageToWord(base64);
```

## 4. 响应说明

### 4.1 成功响应

```json
{
  "status": 200,
  "data": "pub/1728381842163_42.7.docx"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | number | 业务状态码，成功固定为 `200` |
| `data` | string | Word 文件在 OSS 上的对象名（`pub/` 开头），**不是完整 URL、也不是文件内容** |

拿到 `data` 后如何访问文件：

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
| 次数已用完 | `count_expend_2_file_limit_is_used_up` |
| TextIn 余额不足（40003） | `余额不足，请充值后再使用` |
| TextIn 文件过大/类型不支持（40301/40302/40303/40304） | `文件大小不超过 50M` 等对应文案 |
| TextIn QPS 超限（40306） | 对应文案（**收到后请勿重试**，持续请求可能触发 IP 流控） |
| TextIn 其他错误 / 返回结果缺少 docx | 对应文案；无映射或结果为空时兜底为 `图片转Word失败` |
| 上传 OSS 失败 | 由 OSS SDK 抛出的错误信息 |

> 调用方务必同时判断 HTTP `res.ok` 与 `body.status === 200`，不要只看 `body.status`（历史中间件行为）。

## 5. 鉴权与次数限制

- **鉴权**：通过请求头 `x-user-id` 识别用户（openid）。该接口未做 token 校验，公网暴露前需在网关补权限。
- **次数限制**：复用 `expend_2_file` 的次数额度 `count_expend_2_file_limit`（与 `base64_to_pdf` 保持一致）。
  - 请求进入时中间件先预检查额度，额度为 0 直接返回 `count_expend_2_file_limit_is_used_up`；
  - 成功后调用 `consumeCountLimit` 扣减 1 次；
  - 当服务端 `limitCheck = false`（全局开关关闭）时不校验、不扣减。

## 6. 注意事项

1. **一次一张图**：本接口入参是字符串 `base64`，不是数组。多张图请多次调用，或改用 `base64_to_pdf`。
2. **base64 属于 OCR 还原**：输出是识别还原的 Word，排版/文字可能不完全等于原图，前端需有容错与预览。
3. **base64 会让请求体显著变大**：base64 相比原图约膨胀 33%。大图请注意网关 / nginx 的
   `client_max_body_size`，必要时先在前端压缩图片。
4. **接口耗时**：包含一次 TextIn 识别（比拼接 PDF 慢）+ 一次 OSS 上传，通常 3~15s。建议前端超时不低于 60s。
5. **返回的是文件名而非二进制**：若前端需要直接下载/预览，请自行拼 `https://fms.whalepea.com/${data}`。
6. **无重试与降级**：TextIn 或 OSS 失败时接口直接报错，重试需调用方自行实现（40306 除外，勿重试）。

## 7. 相关接口

- `POST /api/file/base64_to_pdf`：图片 base64 数组 → PDF，见 [`prddoc/file-base64-to-pdf-api.md`](./file-base64-to-pdf-api.md)。
- `POST /api/file/expend_2_file`：图片地址（`file_urls`）→ PDF / Word，支持 `to_type=pdf|docx`。
- `GET /api/file/get/:bucketname/:filename`：文件跳转接口，302 到 `https://fms.whalepea.com`。
- `POST /api/file/text_2_word`：文本 → Word。
