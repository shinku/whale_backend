# AGENTS.md

本仓库对 AI 编码助手的约定。

## dev server 默认已经在跑，改完代码不要重复 `npm run dev`

`npm run dev`（= `node dev.js`）会一次拉起两个带 watch 的进程：

- 后端 `dev-app`：`mwtsc --watch --run @midwayjs/mock/app.js`，监听 7001，改 `src/` 会自动重新编译并重启应用；
- 前端 `front`：`vite`，监听 3000，走 HMR。

所以**改完代码直接等 1~2 秒再验证即可，不要再执行 `npm run dev`**，
重复跑会撞端口、起出多余的 node 进程（尤其会抢 7001）。

不确定是否已经在跑时，先只读检查，不要盲启：

```bash
lsof -nP -iTCP:7001 -sTCP:LISTEN   # 后端
lsof -nP -iTCP:3000 -sTCP:LISTEN   # 前端
curl -s -o /dev/null -w "%{http_code}\n" --max-time 5 http://127.0.0.1:7001/
```

有监听 / 返回 200 就说明已经在跑。只有当端口没人监听（watch 进程真的挂了）时才手动起一次。

## 验证、排查一律在内存里跑，不要新建临时脚本文件

需要验证运行时行为（跑个函数、连数据库查一行、打接口、试一段抓取逻辑）时，
用 `node -e` / `ts-node -e` / heredoc 直接执行，**不要新建 `xxx.ts`、`xxx.js` 之类的验证文件**，
也不要往仓库里写临时文件。验证完 `git status` 里只应该有本次改动真正需要的文件。

### 1. 跑源码里的模块（推荐）

```bash
node -r ts-node/register/transpile-only -e "const {parsePublishTimeFromUrl}=require('./src/service/PlaywrightService'); console.log(parsePublishTimeFromUrl('https://www.zhongkao.com/e/20250616/685.shtml'));"
```

### 2. 多行脚本用 heredoc（同样不落盘）

```bash
node -r ts-node/register/transpile-only <<'JS'
const { isPolicyRelated } = require('./src/service/NewsService');
console.log('政策相关:', isPolicyRelated('教育部印发通知'), '| 非政策:', isPolicyRelated('校园运动会'));
JS
```

### 3. 需要数据库 / 依赖注入 / 路由的完整上下文

先用 `npm run build`，再启动一个 mock 应用，然后在同一个脚本里打接口或直接取服务实例：

```bash
NODE_ENV=local MIDWAY_HTTP_PORT=7101 node -r ts-node/register/transpile-only <<'JS'
const { createApp, createHttpRequest, close } = require('@midwayjs/mock');
(async () => {
  const app = await createApp();
  const res = await createHttpRequest(app).get('/api/edu/news');
  console.log(res.body.data.count);
  // 也可以直接拿服务实例：await app.createAnonymousContext().requestContext.getAsync(require('./src/service/NewsService').NewsService)
  await close(app);
  process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
JS
```

注意两点：

- `createApp()` 不要传 appDir/baseDir，否则会扫到 `front/eslint.config.js` 这类 ESM 文件直接报错。
- 本机 7001 常被你自己的 dev server 占着，mock 应用用 `MIDWAY_HTTP_PORT` 换端口。

### 4. 跑编译产物

```bash
npm run build && node -e "const {cleanTitle}=require('./dist/service/PlaywrightService'); console.log(cleanTitle('标题_频道_站名'));"
```

### 例外

- `test/` 目录下的正式单测（jest）属于交付代码，可以新增和维护；本条只约束临时验证脚本。
- 万一某个场景确实没法在 `-e` / heredoc 里跑通，先说清楚原因，再决定要不要落文件。
- Playwright / chromium 的启动日志噪音很大，用 `| grep -vE "^\s*$|^\[2m|^<(launching|launched)|^\[pid=|Call log|^  - "` 过滤。
