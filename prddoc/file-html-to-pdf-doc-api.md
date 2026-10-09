# HTML 转 PDF / Word 接口对接文档（/api/file/html_to_pdf、/api/file/html_to_doc）

## 1. 接口概述

两个接口都是「前端把自己拼好的 HTML 交给服务端，导出成可下载的文件」：

| 接口 | 路径 | 产物 | 实现 |
| --- | --- | --- | --- |
| HTML 转 PDF | `POST /api/file/html_to_pdf` | `.pdf` | 无头 Chromium 渲染 HTML 后打印（保真还原样式） |
| HTML 转 Word | `POST /api/file/html_to_doc` | `.docx`（真 OOXML） | 默认 `regural`：`html-docxjs-compiler` 把 HTML 转成 docx 元素后打包；可选 `pdfkit-convert`：HTML→PDF 保真渲染后按页转图片再塞进 docx |

两者的整体行为一致：校验参数 → 生成文件 → 上传 OSS → 返回文件名。

| 项 | 说明 |
| --- | --- |
| 请求方式 | `POST` |
| Content-Type | `application/json` |
| 鉴权 | 必须携带请求头 `x-user-id`（用户 openid），缺失直接报错 |
| 响应格式 | `application/json; charset=utf-8` |
| 是否流式 | 否，一次性返回结果 |
| 返回内容 | 上传成功后的文件名（不是文件内容） |

> 路径说明：控制器使用 `@Api('/file')` 装饰，实际前缀为 `/api`。
> 对应源码：`src/controller/file.ts`（`htmlToPdf` / `htmlToDoc`）、
> `src/service/FileService.ts`（`htmlToPdf` / `htmlToDoc`）、
> `src/service/PlaywrightService.ts`（`renderHtmlToPdf`）、
> `src/service/utils/file.ts`（`htmlToDocx` / `pdfBufferToDocx` 等转换实现）。

## 2. 请求参数

### 2.1 请求头

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | 固定 `application/json` |
| `x-user-id` | 是 | 用户 openid。缺失时报 `{"status":404,"message":"userId is required"}` |

### 2.2 html_to_pdf 请求体

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `html` | string | 是 | - | 完整 HTML 文档或片段，片段会被浏览器自动补全 `html/body` |
| `format` | string | 否 | `A4` | 纸张尺寸，常用 `A4` / `A3` / `Letter` |
| `landscape` | boolean | 否 | `false` | 是否横向 |
| `print_background` | boolean | 否 | `true` | 是否打印背景色/背景图。传 `false` 时 CSS 背景、色块会丢失 |
| `lane` | string | 否 | `whale` | 业务线，用于区分次数限制，一般前端不用传 |

页边距固定为 上下 12mm、左右 10mm，暂不可配。

### 2.3 html_to_doc 请求体

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `html` | string | 是 | 完整 HTML 文档或片段 |
| `toStrategy` | string | 否 | 转换策略，默认 `regural`；可选 `pdfkit-convert`（取值非法时按 `regural` 处理） |
| `lane` | string | 否 | 业务线，默认 `whale`，一般前端不用传 |

两种策略：

| 策略 | 原理 | 特点 |
| --- | --- | --- |
| `regural`（默认） | `html-docxjs-compiler` 把 HTML 解析成 docx 元素后打包 | 稳定、产物是真正的可编辑 Word 元素；但复杂布局/样式还原度有限 |
| `pdfkit-convert` | 无头 Chromium 把 HTML 渲染成 PDF，再把 PDF 每一页光栅化成图片后塞进 docx | 保真度高（几乎和 PDF 一模一样）；产物体积更大、Word 里是整页图片不可编辑，且偶发报错 |

> `pdfkit-convert` 失败时默认会自动回退到 `regural`，保证接口仍能返回结果。

### 2.4 校验规则

- `x-user-id` 缺失 → `userId is required`
- `html` 为空字符串、`null`、`undefined` → `html is empty`

## 3. 请求示例

### 3.1 curl

```bash
# HTML -> PDF
curl -X POST 'http://localhost:7001/api/file/html_to_pdf' \
  -H 'Content-Type: application/json' \
  -H 'x-user-id: <用户openid>' \
  -d '{
    "html": "<h1 style=\"color:#c00\">标题</h1><p>正文</p>",
    "format": "A4",
    "landscape": false,
    "print_background": true
  }'

# HTML -> Word
curl -X POST 'http://localhost:7001/api/file/html_to_doc' \
  -H 'Content-Type: application/json' \
  -H 'x-user-id: <用户openid>' \
  -d '{
    "html": "<h1>标题</h1><p>正文</p>",
    "toStrategy": "regural"
  }'

# HTML -> Word（PDF 保真策略：几乎和 html_to_pdf 一模一样）
curl -X POST 'http://localhost:7001/api/file/html_to_doc' \
  -H 'Content-Type: application/json' \
  -H 'x-user-id: <用户openid>' \
  -d '{
    "html": "<h1>标题</h1><p>正文</p>",
    "toStrategy": "pdfkit-convert"
  }'
```

### 3.2 前端调用（fetch）

```js
async function htmlToPdf(html, options = {}) {
  const res = await fetch('/api/file/html_to_pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': getUserId(), // 用户 openid
    },
    body: JSON.stringify({
      html,
      format: options.format,             // 'A4' | 'A3' | 'Letter'
      landscape: options.landscape,       // boolean
      print_background: options.printBackground, // boolean，默认 true
    }),
  });
  const json = await res.json();
  if (!res.ok || json.status !== 200) {
    throw new Error(json.message || 'HTML转PDF失败');
  }
  return json.data; // "pub/1728381842163_42.7.pdf"
}

async function htmlToDoc(html, toStrategy = 'regural') {
  const res = await fetch('/api/file/html_to_doc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': getUserId(),
    },
    body: JSON.stringify({ html, toStrategy }), // 'regural' | 'pdfkit-convert'
  });
  const json = await res.json();
  if (!res.ok || json.status !== 200) {
    throw new Error(json.message || 'HTML转Word失败');
  }
  return json.data; // "pub/1728381842163_42.7.docx"
}
```

## 4. 响应说明

### 4.1 成功响应

```json
{ "status": 200, "data": "pub/1728381842163_42.7.pdf" }
```

```json
{ "status": 200, "data": "pub/1728381842163_42.7.docx" }
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | number | 业务状态码，成功固定为 `200` |
| `data` | string | 文件在 OSS 上的对象名（`pub/` 开头），**不是完整 URL、也不是文件内容** |

拿到 `data` 后如何访问文件：

```js
const fileUrl = `https://fms.whalepea.com/${fileName}`;   // 直链
const jumpUrl = `/api/file/get/${fileName}`;              // 后端 302 跳转到 fms.whalepea.com
```

> 提示：`data` 已经带 `pub/` 前缀，拼接直链时不要再额外加目录。

### 4.2 异常情况

错误由全局中间件统一包装，**HTTP 状态码为 500，响应体 `status` 为 404**：

```json
{ "status": 404, "message": "<错误信息>" }
```

| 场景 | `message` |
| --- | --- |
| 未登录 / 未带 `x-user-id` | `userId is required` |
| `html` 为空 | `html is empty` |
| 次数已用完 | `count_convert_file_limit_is_used_up` |
| Chromium 渲染超时（如页面引用了打不开的外链资源） | Playwright 的 timeout 错误信息 |
| docx 生成失败（HTML 结构异常） | 对应错误信息 |
| 上传 OSS 失败 | 由 OSS SDK 抛出的错误信息 |

> 调用方务必同时判断 HTTP `res.ok` 与 `body.status === 200`，不要只看 `body.status`（历史中间件行为）。

## 5. 鉴权与次数限制

- **鉴权**：通过请求头 `x-user-id` 识别用户（openid）。该接口未做 token 校验，公网暴露前需在网关补权限。
- **次数限制**：两个接口共用 `count_convert_file_limit`（文件转换额度）。
  - 请求进入时中间件先预检查额度，额度为 0 直接返回 `count_convert_file_limit_is_used_up`；
  - 成功后调用 `consumeCountLimit` 扣减 1 次；
  - 当服务端 `limitCheck = false`（全局开关关闭）时不校验、不扣减。

## 6. 两个接口的差异与注意事项

### 6.1 html_to_pdf

1. **真实浏览器渲染**：用的是无头 Chromium，CSS、flex/grid、网页字体、内联 SVG 等都能比较如实地还原成 PDF。
2. **外部资源要能访问**：`<img src="https://...">`、外链 CSS/字体需要 Chromium 能访问到；内网/需鉴权的地址会加载失败。
   建议图片先用 base64 内联（`data:image/...;base64,`）或传可公网访问的 URL。
3. **接口耗时**：包含一次浏览器渲染，通常 1~5s（首屏拉起浏览器时更久）。建议前端超时不低于 30s。
4. **打印样式**：影响的是“打印”效果，页面里 `@media print` 的规则会生效；`print_background` 默认为 `true`。

### 6.2 html_to_doc

1. **产物是真 `.docx`**（OOXML），不是把 HTML 改名的伪 Word 文件。
2. **两种转换策略**（`toStrategy`）：
   - `regural`（默认）：把 HTML 转成 docx **元素**，产物可继续在 Word 里编辑。
     - 保真度有限：只映射标题、段落、列表、表格、粗体/斜体/下划线/删除线、部分行内样式（颜色、对齐等）。
     - **CSS 类/外部样式表不生效**：请尽量用**行内 style**，因为转换器不解析 `<style>` 里的选择器。
     - 复杂布局（定位、flex/grid、多栏、阴影、圆角等）不会还原。
   - `pdfkit-convert`：Chromium 把 HTML 渲染成 PDF，再把 **PDF 每一页转成一张 PNG** 后放进 docx，每个 PDF 页对应一个 docx 分节，几乎 100% 还原 PDF 样式与分页。
     - 产物在 Word 里是**整页图片**，不可编辑；文件体积明显更大（可用 `scale` 调整清晰度，未开放给接口参数，默认 2 倍）。
     - 走一次浏览器渲染，耗时与 `html_to_pdf` 相当（通常 1~5s）。
     - 该策略偶发报错，**默认失败时自动回退到 `regural`**。
3. **图片**（主要针对 `regural` 策略）：
   - `data:image/...;base64,...` 内联图片支持；
   - `http/https` 外链图片**默认不会下载**（未配置下载策略），会被跳过，请在 docx 预览里做好容错。
4. **接口耗时**：`regural` 基本是本地转换 + OSS 上传，通常 < 1s；`pdfkit-convert` 含一次浏览器渲染，通常 1~5s。

### 6.3 通用

- **返回的是文件名而非二进制**：若前端需要下载/预览，请自行拼 `https://fms.whalepea.com/${data}`。
- **无重试与降级**：失败时接口直接报错，重试需调用方自行实现。
- **HTML 体积**：HTML 内联 base64 图片时会显著变大，大图请注意网关 / nginx 的 `client_max_body_size`。

## 7. 相关接口

- `POST /api/file/base64_to_pdf`：图片 base64 数组 → PDF，见 [`prddoc/file-base64-to-pdf-api.md`](./file-base64-to-pdf-api.md)。
- `POST /api/file/base64_to_word`：单张图片 base64 → Word，见 [`prddoc/file-base64-to-word-api.md`](./file-base64-to-word-api.md)。
- `POST /api/file/text_2_word`：文本 → Word。
- `GET /api/file/get/:bucketname/:filename`：文件跳转接口，302 到 `https://fms.whalepea.com`。
