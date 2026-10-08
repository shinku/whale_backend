# 图片拼接 PDF 接口对接文档（/api/file/base64_to_pdf）

## 1. 接口概述

该接口用于「前端直接拿着 base64 图片，让服务端拼成一个 PDF」：调用方把若干张图片的 base64
放进 `base64_list`，服务端调用合合信息（TextIn）的 `image-to-pdf` 接口拼接，把生成的 PDF
上传到 OSS，最后返回可访问的文件名。

与老接口 `POST /api/file/expend_2_file` 的区别：老接口传的是 OSS 上的图片地址 `file_urls`，
新接口传的是图片 base64，前端无需先把图片传到服务器。

| 项 | 说明 |
| --- | --- |
| 请求方式 | `POST` |
| 请求路径 | `/api/file/base64_to_pdf` |
| Content-Type | `application/json` |
| 鉴权 | 必须携带请求头 `x-user-id`（用户 openid），缺失直接报错 |
| 响应格式 | `application/json; charset=utf-8` |
| 是否流式 | 否，一次性返回结果 |
| 返回内容 | 上传成功后的文件名（不是文件内容） |

> 路径说明：控制器使用 `@Api('/file')` 装饰，实际前缀为 `/api`，因此对外路径是 `/api/file/base64_to_pdf`。
> 对应源码：`src/controller/file.ts`（`base64ToPdf`）、`src/service/ImageService.ts`（`tiBase64ImageToPdf`）。

## 2. 请求参数

### 2.1 请求头

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | 固定 `application/json` |
| `x-user-id` | 是 | 用户 openid。缺失时报 `{"status":404,"message":"userId is required"}` |

### 2.2 请求体

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `base64_list` | string[] | 是 | 图片的 base64 数组，**按数组顺序拼接到 PDF**（第一张为第 1 页） |
| `lane` | string | 否 | 业务线，默认 `whale`。用于区分次数限制，一般前端不用传 |

校验规则：

- `x-user-id` 缺失 → 报错 `userId is required`。
- `base64_list` 为空数组、`null`、`undefined` → 报错 `base64_list is empty`。

### 2.3 base64 格式说明

数组每一项可以是下面两种写法，服务端会统一处理：

1. **纯 base64**：`"iVBORw0KGgoAAAANSUhEUg..."`（推荐，体积最小）
2. **data URL**：`"data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..."`（前端 `canvas.toDataURL()` 的原始输出可直接传）

服务端在调用 TextIn 前会自动去掉 `data:image/xxx;base64,` 前缀，所以前端无需手动裁剪。

### 2.4 图片要求

- 单张图片大小不超过 50M（TextIn 限制）。
- 图像宽高需介于 20 ~ 10000 像素之间。
- 支持 jpg / jpeg / png / gif / bmp / webp 等常见格式；格式不支持时 TextIn 会返回实际检测到的类型。

## 3. 请求示例

### 3.1 curl

```bash
curl -X POST 'http://localhost:7001/api/file/base64_to_pdf' \
  -H 'Content-Type: application/json' \
  -H 'x-user-id: <用户openid>' \
  -d '{
    "base64_list": [
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...",
      "iVBORw0KGgoAAAANSUhEUg..."
    ]
  }'
```

### 3.2 前端调用（fetch）

```js
/**
 * @param {string[]} base64List 图片 base64 数组，可带 data URL 前缀，顺序即 PDF 页序
 */
async function imagesToPdf(base64List) {
  const res = await fetch('/api/file/base64_to_pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': getUserId(), // 用户 openid
    },
    body: JSON.stringify({ base64_list: base64List }),
  });
  const json = await res.json();
  // 注意：错误时 HTTP 状态码是 500，但 body.status 为 404，需同时判断
  if (!res.ok || json.status !== 200) {
    throw new Error(json.message || '图片转PDF失败');
  }
  return json.data; // "pub/1728381842163_42.7.pdf"
}
```

### 3.3 典型用法：从 canvas / 文件生成 base64

```js
// canvas 直接导出（自带 data URL 前缀，可直接传）
const base64 = canvas.toDataURL('image/png');
const fileName = await imagesToPdf([base64]);

// File -> base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); // 结果带 data URL 前缀
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
const list = await Promise.all(files.map(fileToBase64));
const fileName = await imagesToPdf(list);
```

## 4. 响应说明

### 4.1 成功响应

```json
{
  "status": 200,
  "data": "pub/1728381842163_42.7.pdf"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | number | 业务状态码，成功固定为 `200` |
| `data` | string | PDF 在 OSS 上的对象名（`pub/` 开头），**不是完整 URL、也不是文件内容** |

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
| `base64_list` 为空 | `base64_list is empty` |
| 次数已用完 | `count_expend_2_file_limit_is_used_up` |
| TextIn 余额不足（40003） | `余额不足，请充值后再使用` |
| TextIn 文件过大/类型不支持（40301/40302/40303/40304） | `文件大小不超过 50M` 等对应文案 |
| TextIn 其他错误 | 对应文案；无映射时兜底为 `图片转PDF失败` |
| 上传 OSS 失败 | 由 OSS SDK 抛出的错误信息 |

> 调用方务必同时判断 HTTP `res.ok` 与 `body.status === 200`，不要只看 `body.status`（历史中间件行为）。

## 5. 鉴权与次数限制

- **鉴权**：通过请求头 `x-user-id` 识别用户（openid）。该接口未做 token 校验，公网暴露前需在网关补权限。
- **次数限制**：复用 `expend_2_file` 的次数额度 `count_expend_2_file_limit`。
  - 请求进入时中间件先预检查额度，额度为 0 直接返回 `count_expend_2_file_limit_is_used_up`；
  - 成功后调用 `consumeCountLimit` 扣减 1 次；
  - 当服务端 `limitCheck = false`（全局开关关闭）时不校验、不扣减。

## 6. 注意事项

1. **同一次请求是「多张图 → 一个 PDF」**，不是多张图各自生成 PDF，页序即 `base64_list` 顺序。
2. **base64 会让请求体显著变大**：base64 相比原图约膨胀 33%。图片较多或较大时，
   请注意网关 / nginx 的 `client_max_body_size`，必要时先在前端压缩图片。
3. **接口耗时**：包含一次 TextIn 网络调用 + 一次 OSS 上传，通常 1~5s。建议前端超时不低于 30s。
4. **返回的是文件名而非二进制**：若前端需要直接下载/预览，请自行拼 `https://fms.whalepea.com/${data}`。
5. **不要传过于异常的输入**：`base64_list` 必须是数组；传字符串等非法类型不会命中「空数组」校验，
   会被原样转发给 TextIn 并大概率返回参数错误。
6. **无重试与降级**：TextIn 或 OSS 失败时接口直接报错，重试需调用方自行实现。

## 7. 相关接口

- `POST /api/file/expend_2_file`：图片地址（`file_urls`）→ PDF / Word，支持 `to_type=pdf|docx`。
- `GET /api/file/get/:bucketname/:filename`：文件跳转接口，302 到 `https://fms.whalepea.com`。
- `POST /api/file/text_2_word`：文本 → Word。
