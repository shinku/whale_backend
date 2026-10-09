# capturePage 返回自包含 HTML（样式 + 图片）

> 交接文档 / 实施计划。目标读者：负责实现的 backend agent。
> 相关接口文档：[`screen-api.md`](./screen-api.md)；相关源码：`src/service/PlaywrightService.ts`、`src/controller/screen.ts`。

## 1. 目标

`POST /api/screen/capture` 返回的 `data.html` 必须是一份**自包含**的 HTML：

1. **样式在内**——外链样式表已内联，CSS 里没有指向原站点的相对地址；
2. **图片在内**——页面上的图片以 `data:image/...;base64,...` 内嵌，不再依赖原站点的图片 URL；
3. **没有脚本**——html 里所有 `<script>` 一律移除：它是一份静态快照，不需要再水合，
   留着只会带来副作用（Next.js dev 调试浮层被重新插回来、React 水合和内联样式互相打架）；
4. 脱离原站点（存成本地文件离线打开、丢给 `/api/file/html_to_pdf`、`/api/file/html_to_doc`）后，
   渲染结果与直接截图一致。

`data.screenshot` 的行为不变（整页 PNG 的 base64）。

## 2. 现状（已完成，不要重做）

第 1 条已经实现并验证过，代码在 `src/service/PlaywrightService.ts`：

| 位置 | 作用 |
| --- | --- |
| `inlinePageAssets()`（约 520 行，`function` 声明） | 在页面里执行：`<link rel=stylesheet>` 内联成 `<style>`（同一个 `<style>` 上带 `data-inlined-from` 标注来源）、CSS `url()` 绝对化、`href/src/poster/data-src/srcset` 绝对化；跨域样式表的 id 通过返回值交给服务端兜底 |
| `absolutizeCssUrls(css, base)`（`export const`） | Node 侧纯函数：把 CSS 里的相对 `url()` 按该 CSS 自己的地址补成绝对地址 |
| `fetchCssSheet(href, depth)` | Node 侧兜底：抓跨域样式表并递归展开它的 `@import`（最多 3 层） |
| `capturePage()`（`async capturePage(...)`） | 组装流程：清理节点 → `page.evaluate(inlinePageAssets)` → 跨域样式兜底 → `page.content()` → 截图 |

**清理节点的既有行为必须保留（不要改）**：

- `[class~="print:hidden"]` **一定要摘掉**：这是 Tailwind 的打印隐藏约定，命中的是页脚、按钮条这类
  只在屏幕上出现的 chrome，不属于要交付的页面内容（摘掉后 415px 宽视口下截图高度是 1068px，保留则会变成 1186px）；
- `script[data-nextjs-dev-overlay]` / `nextjs-portal`：Next.js 开发模式的调试浮层，也要摘掉
  （等「所有 `<script>` 一律移除」落地后，前者自然冗余，但 `nextjs-portal` 元素仍要清）。

历史教训：曾经把 `print:hidden` 的摘除当成「误删」而移除，导致截图里多出页脚/按钮条，**不要再犯**。

已验证结论（可复现，见第 5 节）：

- 返回的 html：`<link rel=stylesheet>` 0 个、根相对属性 0 个、CSS 内相对 `url()` 0 个，内联 CSS 约 54KB；
- 把这份 html 挂到临时端口用服务端 chromium 渲染，与直接抓线上页面逐像素差异 **0.01%**；
- 跨域样式表兜底路径已单独验证：异源 CSS 能被服务端抓回、`@import` 展开、其中的字体路径按 CSS 自身地址绝对化。

## 2.1 为什么不是「遍历 DOM 把 computedStyle 写进 style 属性」

另一个看起来很省事的方案：遍历所有元素，读 `getComputedStyle` 拼成一份写死内联样式的 DOM。
在这张页面上实测过之后没有采用，原因是：

| 维度 | computedStyle 内联 | 当前方案（内联 CSS） |
| --- | --- | --- |
| 体积（243 个元素，实测） | 全量计算属性约 **3.4MB**；只挑 25 个常用属性也要 **130KB** | 内联 CSS **54KB**，且是完整规则 |
| 伪元素 `::before/::after` | **表达不了**（style 属性挂不到伪元素上，只能在导出前把伪元素实体化成真实节点） | 天然保留 |
| 媒体查询 / print 规则 | **丢失**（只是「当前视口这一刻」的快照） | 保留（内联 CSS 里有 15 条 `@media`，其中 5 条是 `print`） |
| 下游 PDF（A4） | 会把抓取时的 415px 移动端布局冻进 html：同一份快照在 415px 宽渲染高 1068px、在 794px 宽（A4，也是页面自己 `max-w-[794px]` 的设计宽度）渲染高 1123px，冻结后无法再适配 | 会按渲染宽度正常重排 |
| 图片 / 字体 | 一样是外链 URL，**不解决问题** | 图片按第 3 节内联成 base64 |
| 保真度 | 通常会有细碎偏差（伪元素、`content`、继承的 font 简写等） | 逐像素与线上差异 **0.01%** |

一句话：computedStyle 快照适合「锁定某个尺寸、要一张死图」的场景；
而这里要的是「一份能自己渲染、任意尺寸/打印都成立」的 html，所以保留 CSS、只补绝对地址与内联资源。

## 3. 待实现：图片内联为 base64

> 状态：**已实现**（`inlineImagesInHtml` + `capturePage` 的 `inlineImage`/`maxImageBytes`/
> `maxTotalImageBytes`，控制器已透传）。下面的设计要求保留作为实现说明与验收依据。

### 3.1 覆盖范围

| 位置 | 处理方式 |
| --- | --- |
| `<img src>` | 抓取后替换为 `data:` URI |
| `<img srcset>` / `<source srcset>` | 取浏览器已选中的 `currentSrc`（也就是 `src` 里那个），内联后**删掉 `srcset`**（base64 带描述符没意义，也没必要多份） |
| CSS 里的 `url(...)`（背景图、遮罩、`content: url()` 等） | 在**已内联的 `<style>`** 文本里替换成 `data:` URI；字体（`@font-face` 的 woff/woff2/ttf/otf）**不内联**，保留绝对地址 |
| `<img>` 懒加载 | 用抓取时的 `currentSrc || src || data-src`，即浏览器已经解析出的真实地址 |
| SVG `<image href>`、`<use>` | 可选，同一套 URL 替换逻辑能覆盖就一起做 |

### 3.2 实现位置与手段

放在 **Node 侧、`page.content()` 之后**，不要用页面内的 canvas 转 base64：

- canvas 方案遇到跨域图片会污染画布，`toDataURL()` 直接抛 SecurityError，不可靠；
- Node 侧可以用共享 `BrowserContext` 的 `context.request.get(url)` 抓取，**自带 cookie / referer / UA**，
  与页面自身的请求上下文一致，能拿到需要登录态或防盗链校验的图（服务里已有 `getContext()` 复用逻辑，别另起浏览器）；
- 也可以直接复用 `PlaywrightService` 里已有的图片下载写法（`fetchArticle` / OSS 上传那段有先例）。

处理顺序建议：

1. `page.content()` 拿到 html（此时样式已内联、地址已绝对化）；
2. 扫出所有待内联 URL：`<img>` 的 `currentSrc/src`、`srcset` 候选、以及 `<style>` 里非字体的 `url()`；
3. 按 URL 去重后抓取（限并发，建议 4~6）；
4. 转 `data:<mime>;base64,<...>` 替换回 html；
5. 清理多余的 `srcset`、`loading="lazy"`、`decoding` 之类不再需要的属性（可选，但 `srcset` 必须清）。

另外，**移除脚本**这一步放在页面里做（`page.evaluate` 里 `document.querySelectorAll('script')` 全删），
要放在页面渲染完成之后（也就是现在 `inlinePageAssets` 那个时机）——
期间页面的 JS 已经跑完、DOM 就是最终样子，删掉脚本不影响已渲染的内容，也不影响截图。
注意这一步会让「摘掉 `script[data-nextjs-dev-overlay]`」变成冗余逻辑（全删了就都干净了），可以顺手简化，
但 `nextjs-portal` 元素本身仍要清（它可能作为真实元素存在）。

> 注意：`srcset` 的替换建议直接在 html 字符串上做（该字段就是字符串），`<img>` 用 `currentSrc` 时也把 `src` 一起替换成同一个 data URI，避免两者不一致。

### 3.3 参数与限额（重要）

内联图片会让响应体迅速膨胀（base64 放大约 33%），必须有护栏，且**默认开启**（用户诉求是「html 包含图片 base64」）：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `inlineImage` | `true` | 是否内联图片；传 `false` 时退化成现在的行为（绝对 URL） |
| `maxImageBytes` | `5242880`（5MB） | 单张图片上限，超过就跳过、保留绝对 URL |
| `maxTotalImageBytes` | `20971520`（20MB） | 累计上限，超过后剩下的图片全部保留绝对 URL（按页面顺序处理，先到先得） |

另外：

- **失败降级**：单张抓取失败 / MIME 不是图片 / 超限 → 保留该图的绝对 URL，**不要抛错**，接口整体必须成功；
- **MIME 判定**：优先响应头 `content-type`，缺失时按扩展名，再退到魔数嗅探（至少覆盖 png/jpeg/gif/webp/svg/avif/bmp/ico）；
- 同一 URL 只抓一次（去重），`url()` 与 `<img>` 共用一份缓存；
- 文档需要同步说明：开了图片内联后单次响应可能到数 MB，网关/客户端要注意响应体上限。

### 3.4 控制器

`src/controller/screen.ts` 把新参数透传给 `capturePage`（保持现有默认视口 `width=415 / height=768` 不动，
不要顺手改这两个默认值）；非法参数（负数、非数字）按缺省处理即可，不必新增校验错误。

## 4. 接口契约变化

请求体新增可选字段：

```jsonc
{
  "url": "https://example.com",  // 必填
  "fullPage": true,              // 可选
  "width": 415,                  // 可选
  "height": 768,                 // 可选
  "waitUntil": "load",           // 可选
  "inlineImage": true,           // 新增，可选，默认 true：图片内联成 base64
  "maxImageBytes": 5242880,      // 新增，可选，单张图片上限
  "maxTotalImageBytes": 20971520 // 新增，可选，图片内联总上限
}
```

`data.html` 语义更新为：

> JS 执行后的 DOM；外链样式已内联成 `<style>`、相对地址已绝对化、**图片已内联成 data URI**（超出限额或抓取失败的图片保留绝对 URL）、
> **`<script>` 已全部移除**（静态快照，不再执行任何脚本）。
> 内联的来源会带标注：样式用 `data-inlined-from`，图片建议用 `data-inlined-src`（保留原始地址，便于排查）。

## 5. 验收标准（必须逐条给出证据）

1. **静态检查**：对 `data.html` 断言
   - `<link rel="stylesheet">` 数量为 0；
   - `<script>` 标签数量为 0（含 `type="application/ld+json"` 之类的内联脚本，静态快照一概不留）；
   - `class~="print:hidden"` 的元素数量为 0（摘除逻辑没被改掉）；
   - `href/src/poster/data-src` 里没有以 `/` 开头的根相对地址；
   - `<img>` 的 `src`（以及 `<style>` 里的候选 `url()`）里**没有**非 `data:` 的图片地址
     （例外：`@font-face` 的字体 URL 允许是绝对 `http(s)`）；
   - `srcset` 已清空或只含 `data:`。
2. **保真度**：把返回的 `data.html` 写到临时文件 → 用一个临时 http server 挂载 →
   用 7001 正在跑的服务端 chromium 再抓一次该临时地址 → 与直接抓线上页面的截图逐像素比对，
   差异 < 1%（改造前样式丢失时是 11.77%，现在是 0.01%，所以这其实是「有没有退化」的回归线）；
   同时确认截图尺寸仍是 415×1068（证明确实摘干净了 `print:hidden`）。
3. **体积**：给出改造前后 `data.html` 大小与图片内联张数，确认没有异常膨胀（例如把整页图片都塞进去仍然可控）。
4. **限额分支**：把 `maxTotalImageBytes` 设小（例如 1000）跑一次，确认接口仍返回 200、超限图片保留绝对 URL、其余正常内联。
5. **工程检查**：`npx tsc --noEmit -p tsconfig.json` 通过；`npx mwts check src/service/PlaywrightService.ts` 不新增问题。
6. **接口回归**：`inlineImage: false` 时的 html 与改造前一致（不影响老调用方）。

## 6. 验证环境注意事项（踩过的坑）

- 本机 dev server 已经在跑（`mwtsc --watch --run`，后端 7001、前端 3000），**改完代码不要跑 `npm run dev`**，
  watch 会自动重编译；不确定在跑就用 `lsof -nP -iTCP:7001 -sTCP:LISTEN` 看（详见仓库根 `AGENTS.md`）。
- **沙箱里直接 `chromium.launch()` 会失败**（`bootstrap_check_in ... Permission denied`），
  所以「渲染验证」必须借 7001 那份服务端 chromium：把待验证的 html 挂到临时 http 端口（如 7199），
  再 `POST /api/screen/capture` 让它去渲染。
- 验证脚本一律 `node -e` / heredoc，不要往仓库写临时验证文件（`AGENTS.md` 要求）。
  Playwright 日志噪音大，用 `| grep -vE "^\s*$|^\[2m|^<(launching|launched)|^\[pid=|Call log|^  - "` 过滤。
- 但**每轮验证最终要落盘的产物**是 `output/tmp/screen-capture-<requestid>/`（这张页面的 `capture.html` + `capture.png`），
  这是用户明确要的交付物，不算临时文件。

## 7. 目标验证页面

```
http://localhost:3000/subjects/arithmetic/detail?userId=ogWqv7bk5oeWO7c0thPq5UofgB8E&requestid=7cf8e67c-4b55-411c-bb80-bbc9717ebcae
```

这张页面适合做验收样本：Next.js SPA、样式全在外链 CSS（两份，约 44KB）、
页眉有一张 58×58 的二维码（`<img srcset>`），正文 40 道口算题的排版对样式缺失很敏感。

## 8. 风险与回滚

- 体积：图片内联后响应体可能上 MB，前端预览 / 网关都要留意；`inlineImage` 开关和两个限额就是回滚阀。
- 抓图片会多一轮网络请求，页面图片多时会拉长接口耗时；限额 + 并发控制 + 单张失败降级可缓解。
- 加密 / 防盗链 / 需要特殊 referer 的图片可能抓不到，此时按失败降级保留绝对 URL，不影响接口成功。

## 9. 交付物清单

1. `src/service/PlaywrightService.ts`：图片内联实现 + 参数；
2. `src/controller/screen.ts`：参数透传；
3. `prddoc/screen-api.md`：请求参数、`data.html` 语义、体积说明同步更新；
4. `output/tmp/screen-capture-7cf8e67c/`：`capture.html`（自包含）+ `capture.png`；
5. 第 5 节各条验收的证据（命令 + 数字）。
