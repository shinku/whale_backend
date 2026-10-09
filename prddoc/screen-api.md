# 网页截图接口对接文档（/api/screen/capture）

## 1. 接口概述

该接口用于「给一个 URL，拿到这个页面的完整 HTML 和截图」：服务端用无头 chromium（Playwright）
打开目标地址，等页面 `load`（onload）之后，抓取完整 HTML 与整页截图的 base64 一并返回。

返回的 `html` 是**自包含**的静态快照：

1. 外链样式表内联进 `<style>`，CSS 与标签属性里的相对地址（`url()`、`href`、`src`、`srcset`…）
   补成绝对地址；
2. 图片（`<img>` 的 `src`/`srcset`、`<style>` 里非字体的 `url()`）内联成 `data:image/...;base64,...`；
3. `<script>` 全部移除——静态快照不需要再水合，留着只会让框架把 DOM 改回去。

所以这份 html 脱离原站点也能正常渲染，可以直接存文件离线打开、或丢给
`/api/file/html_to_pdf`、`/api/file/html_to_doc`（它们用 `setContent()` 渲染，没有 base URL）。

典型用途：把任意网页转成图片、抓取渲染后的静态 HTML（含 JS 执行结果），供前端预览或做二次处理。

| 项 | 说明 |
| --- | --- |
| 请求方式 | `POST` |
| 请求路径 | `/api/screen/capture` |
| Content-Type | `application/json` |
| 鉴权 | 无（该路由未挂鉴权中间件） |
| 响应格式 | `application/json; charset=utf-8` |
| 是否流式 | 否，一次性返回完整结果 |
| 返回内容 | 页面完整 HTML（样式已内联、地址已绝对化）+ 整页截图的 base64（PNG） |

> 路径说明：控制器使用 `@Api('/screen')` 装饰，实际前缀为 `/api`，因此对外路径是 `/api/screen/capture`。
> 对应源码：`src/controller/screen.ts`（`capture`）、`src/service/PlaywrightService.ts`（`capturePage`）。

## 2. 请求参数

请求体为 JSON 对象，只有 `url` 必填：

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `url` | string | 是 | - | 目标地址，必须以 `http://` 或 `https://` 开头 |
| `fullPage` | boolean | 否 | `true` | 是否整页截图。`true` 截整个滚动区域，`false` 只截视口 |
| `width` | number | 否 | `1440` | 视口宽度（像素）。传了 `width`/`height` 才生效 |
| `height` | number | 否 | `900` | 视口高度（像素） |
| `waitUntil` | string | 否 | `load` | 截取时机：`load` / `domcontentloaded` / `networkidle` |
| `inlineImage` | boolean | 否 | `true` | 是否把图片内联成 base64。传 `false` 退化成「图片仍是绝对 URL」 |
| `maxImageBytes` | number | 否 | `5242880` | 单张图片上限（图片原始字节）。超限则该图保留绝对 URL |
| `maxTotalImageBytes` | number | 否 | `20971520` | 图片内联总量上限。超出后剩下的图片保留绝对 URL（按页面顺序，先到先得） |

校验规则：

- 未传 `url` → 报错 `url is required`。
- `url` 不是 `http/https` 开头 → 报错 `url is invalid`。

图片内联的降级规则（都不会让接口失败）：

- 抓取失败 / 响应不是图片 / 超过单张或总量上限 → 该图保留绝对 URL；
- 同一地址只抓一次（`src`、`srcset`、CSS `url()` 共用一份缓存），代价是多一轮图片请求；
- 内联后的 `<img>` 会去掉 `srcset` 与 `loading="lazy"`（一个 data URI 没必要再给多份候选）；
- `@font-face` 的字体**不内联**，仍是绝对地址。

`waitUntil` 语义（Playwright）：

| 取值 | 含义 |
| --- | --- |
| `load` | 页面的 `load` 事件（onload）触发后返回，默认值 |
| `domcontentloaded` | DOM 解析完成即返回（不等图片/CSS） |
| `networkidle` | 网络基本空闲后返回（等懒加载更充分，但长连接/轮询页面可能超时） |

## 3. 请求示例

### 3.1 curl

```bash
curl -X POST 'http://localhost:7001/api/screen/capture' \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "fullPage": true
  }'
```

### 3.2 前端调用（fetch）

```js
/**
 * @returns {Promise<{ url: string, html: string, screenshot: string }>}
 *   html：渲染后的完整 HTML，样式已内联、相对地址已绝对化（自包含，脱离原站点也能渲染）
 *   screenshot：整页截图的 base64（PNG，不带 data URL 前缀）
 */
async function capturePage(url, options = {}) {
  const res = await fetch('/api/screen/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, ...options }),
  });
  const json = await res.json();
  // 错误时 HTTP 500、body.status 404，需同时判断
  if (!res.ok || json.status !== 200) {
    throw new Error(json.message || '截图失败');
  }
  return json.data;
}

const { html, screenshot } = await capturePage('https://example.com');

// 直接给 img 用：需要自己拼 data URL 前缀
imgEl.src = `data:image/png;base64,${screenshot}`;

// 需要下载成文件时
const bytes = Uint8Array.from(atob(screenshot), c => c.charCodeAt(0));
const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
```

## 4. 响应说明

### 4.1 成功响应

```json
{
  "status": 200,
  "data": {
    "url": "https://example.com",
    "html": "<!DOCTYPE html><html>...</html>",
    "screenshot": "iVBORw0KGgoAAAANSUhEUgAA..."
  }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | number | 业务状态码，成功固定为 `200` |
| `data.url` | string | 实际访问的地址（等于入参 `url`） |
| `data.html` | string | 页面完整 HTML：JS 执行后的 DOM，且外链样式已内联成 `<style>`、相对地址已补成绝对地址（内联的 `<style>` 上带 `data-inlined-from` 标注来源） |
| `data.screenshot` | string | 截图的 base64 字符串，**PNG 格式，不带 `data:image/png;base64,` 前缀** |

### 4.2 异常情况

错误由全局中间件统一包装，**HTTP 状态码为 500，响应体 `status` 为 404**：

```json
{ "status": 404, "message": "<错误信息>" }
```

常见错误信息：

| 场景 | `message` |
| --- | --- |
| 未传 `url` | `url is required` |
| `url` 不是 http/https | `url is invalid` |
| 目标页面打不开 / 证书错误 / 等待超时 | Playwright 抛出的错误（如 `page.goto: Timeout 30000ms exceeded`） |

> 调用方应同时判断 HTTP 200 与 `body.status === 200`。
> `url is invalid` 是服务端主动校验（避免非 http 协议）；其余多为 Playwright 原始错误信息，前端做「打开失败」兜底提示即可。

## 5. 超时与资源

- 单页加载/等待超时为 `eduNews.timeout`（默认 **30s**，见 `src/config/config.default.ts`）。
  目标站点慢或 `waitUntil: 'networkidle'` 时可能超时，前端超时建议不低于 **60s**。
- 截图大小取决于页面长度与视口宽度：长页面整页截图 + base64 会明显膨胀（base64 约放大 33%），
  大页面单次响应可能到数 MB，注意网关/客户端的响应体大小限制。
- 页面加载依赖无头 chromium，冷启动首个请求会慢一些；浏览器实例由
  `PlaywrightService` 复用（与教育新闻采集共用同一个 context）。

## 6. 注意事项

1. **无鉴权**：该路由未挂鉴权中间件，暴露公网前请在网关或中间件层补充登录与限流。
2. **SSRF 风险**：接口会访问调用方传入的任意地址（含内网地址）。若面向不可信调用方开放，
   需要在网关/服务端做目标地址白名单或内网地址拦截。
3. **html 是「渲染后 + 自包含」的 DOM**：`data.html` 由 `page.content()` 序列化，包含 JS 执行后写入的内容，
   但仍是当前节点的序列化结果，不等于原始响应体。样式与图片都在里面，`<script>` 已被移除；
   注意这会让 `html` 明显变大（内联 CSS 几十 KB 起步，图片按 base64 约放大 1/3）。
   例外是**跨域样式表**（如 CDN 上的字体 CSS）：浏览器读不到 `cssRules`（SecurityError），
   改由服务端再抓一次内联；万一带不上（比如需要特殊 UA / 防盗链），该 `<link>` 会原样保留，
   这种情况多出现在三方 CDN，自建站点的样式表都能正常内联。
4. **`fullPage: true` 可能很长**：内容无限滚动的页面截出来会非常大，必要时传 `fullPage: false` 只截首屏。
5. **不支持登录态**：接口不会为目标站点注入 cookie，需要登录的页面会跳到登录页或报错。
6. **无重试与降级**：页面加载失败时接口直接返回 500，重试需调用方自行实现。

## 7. 相关接口

| 接口 | 说明 |
| --- | --- |
| `POST /api/file/html_to_pdf` | 传入 HTML 字符串 → 渲染成 PDF（不访问外部 URL） |
| `POST /api/file/html_to_doc` | 传入 HTML 字符串 → 渲染成 Word |
| `POST /api/screen/capture` | 传入 URL → 返回渲染后的 HTML + 截图 base64 |
