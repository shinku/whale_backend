# my-midway-project

## 快速入门

如需进一步了解，参见 [midway 文档][midway]。

### 环境要求

- Node.js `>= 20`（教育新闻采集用到 deepagents / LangChain，要求 20 及以上）
- [Podman](https://podman.io) `>= 4.7`（本地 MySQL 跑在容器里；macOS 需要 podman machine）
- Python 3（仅 `call_task/py` 里的 Office / PDF 转换脚本需要）

### 本地开发

#### 1. 启动本地数据库（Podman + MySQL 8）

数据库参数与 `src/config/config.local.ts` 中 `sequelize.dataSource.default` 一一对应，见
[compose.yml](./compose.yml)：

| `config.local.ts` | `compose.yml` |
| --- | --- |
| `host: 127.0.0.1`、`port: 3306` | `ports: 127.0.0.1:3306:3306` |
| `database: whale_db` | `MYSQL_DATABASE: whale_db` |
| `username: root`、`password: STARKU0303` | `MYSQL_ROOT_PASSWORD: STARKU0303` |
| `timezone: '+08:00'` | `TZ=Asia/Shanghai` + `--default-time-zone=+08:00` |
| `dialect: mysql` | 镜像 `mysql:8.0` |
| `sync: true` | 表结构由 sequelize 在启动时自动创建 |

macOS 上先安装 podman 并初始化虚拟机（只需一次）：

```bash
$ brew install podman podman-compose
$ podman machine init && podman machine start   # Linux 无需这一步
```

然后在项目根目录启动数据库容器：

```bash
$ podman compose up -d
```

首次执行会下载 podman 虚拟机镜像和 mysql 镜像，耗时取决于网络。国内拉 docker.io
较慢时，可在项目根目录创建 `.env`（已被 `.gitignore` 忽略）改用镜像站，再重新执行
上面的启动命令：

```bash
MYSQL_IMAGE=docker.m.daocloud.io/library/mysql:8.0
```

#### 2. 初始化数据库（无需手动建表）

数据库初始化完全在应用内部完成，不需要额外的 init / migration 脚本：

- **建库**：`whale_db` 由 `compose.yml` 的 `MYSQL_DATABASE` 在容器首次启动时创建，
  不需要 `docker-entrypoint-initdb.d` 里的 SQL。
- **建表**：表结构由 sequelize 依据 `src/model/*.ts` 在应用启动时自动 `sync`
  （`config.local.ts` 中的 `sync: true`）。所以数据库容器起来之后，直接启动应用即可：

  ```bash
  $ npm i
  $ npm run dev
  ```

  启动过程中会自动创建以下表（日志里能看到 `CREATE TABLE IF NOT EXISTS ...`）：

  | 表名 | 模型 |
  | --- | --- |
  | `user` | `UserModel` |
  | `user_point` | `UserPoint` |
  | `user_point_consume_logs` | `UserPointConsumeLogs` |
  | `user_vip_record` | `UserVipModel` |
  | `user_record_cleanpaper_image` | `UserRecord` |
  | `user_feedback` | `UserFeedBack` |
  | `user_limit_table` | `UserLimitModel` |
  | `banner` | `BannerModel` |
  | `prompt_act` | `PromptModel` |
  | `app_info` | `AppModel` |
  | `app_operate` | `AppOperate` |
  | `edu_news` | `EduNewsModel` |

  sync 是启动时异步执行的，刚启动完立刻查表可能还没建齐，稍等片刻再查。

验证：

```bash
$ podman exec -it whale-mysql mysql -uroot -pSTARKU0303 whale_db -e 'show tables'
```

也可以启动自带的 Adminer 图形客户端 `podman compose --profile tools up -d`，
然后打开 <http://localhost:8080>（服务器 `mysql`、用户名 `root`、密码 `STARKU0303`、数据库 `whale_db`）。

#### 3. 启动前端

`npm run dev` 会同时拉起后端（<http://localhost:7001>）和 `front/` 前端（vite，默认 <http://localhost:5173>）。

### 数据库常用操作

| 目的 | 命令 |
| --- | --- |
| 启动 / 停止（保留数据） | `podman compose up -d` / `podman compose down` |
| 查看容器状态 / 日志 | `podman ps` / `podman compose logs -f mysql` |
| 进入 mysql 交互终端 | `podman exec -it whale-mysql mysql -uroot -pSTARKU0303 whale_db` |
| 重置数据库（删库重建） | `podman compose down -v` |
| 备份 | `podman exec whale-mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --databases whale_db' > whale_db.sql` |
| 恢复 | `podman exec -i whale-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"' < whale_db.sql` |

> `podman compose down -v` 会**删除数据卷连同库内数据，不可恢复**；重新 `podman compose up -d`
> 并启动应用后，库和表会重新自动创建。

### 常见问题

- **3306 端口被占用**：`lsof -nP -iTCP:3306 -sTCP:LISTEN`，停掉占用进程或修改 `compose.yml` 的端口映射
  （同时要改 `config.local.ts` 中的 `port`）。
- **改了 `compose.yml` 参数不生效**：`MYSQL_DATABASE`、字符集等只在数据卷为空时起作用，
  需要 `podman compose down -v && podman compose up -d`。
- **sequelize 报 `ECONNREFUSED`**：容器还没就绪，等 `podman compose logs -f mysql` 里出现
  `ready for connections` 再启动应用。
- **报 `ER_ACCESS_DENIED_ERROR`**：MySQL 8 默认使用 `caching_sha2_password`，`mysql2` 已支持；
  若仍失败，在 `compose.yml` 的 `command` 里追加 `--default-authentication-plugin=mysql_native_password`
  后 `podman compose down -v && podman compose up -d`。
- **字符集**：服务器默认 `utf8mb4`，但 `config.local.ts` 里的 `define.charset: 'utf8'`
  （MySQL 8 中等于 `utf8mb3`）会让 sequelize 建的这些表无法保存 emoji；
  需要时把它改成 `utf8mb4` 并 `podman compose down -v && podman compose up -d`。
- **本地配置不生效**：`src/configuration.ts` 在检测到 `/config/config.json` 时会用文件内容覆盖配置
  （该文件只存在于生产镜像中）。本机一般不存在此文件，因此走 `config.local.ts`；
  `config.local.ts` 已被 `.gitignore` 忽略，换机器时需要按上面的参数自行创建。

## 教育政策新闻采集（deepagents + Playwright）

每天 6:00 和 18:00，`EduNewsTask` 会用 [deepagents](https://github.com/langchain-ai/deepagentsjs)
驱动的 agent 从下面几个站点各取最新 20 条新闻，挑出与教育政策相关的条目，
用无头浏览器打开详情页复制标题 / 正文 / 来源 / 新闻时间，把正文配图下载后经现有的
`OssService` 上传，最后写入 `edu_news` 表。

| 站点 | 列表页 |
| --- | --- |
| 中国青年网 · 教育要闻 | <https://edu.youth.cn/wzlb/> |
| 高考网 · 高考新闻 | <https://www.gaokao.com/baokao/yxdq/gkxxs/> |
| 中考网 · 中考政策 | <https://www.zhongkao.com/baokao/zkzc/> |

站点地址**写在 `NewsService` 的 system prompt 里，不是配置项**；想加站点只改那段提示词即可，
代码会从提示词里自动解析出站点域名，用作 tool 的白名单，模型编出来的其他地址会被拒绝。

### 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/edu/news` | 最新 10 条，`available = true`；`limit` 可选，最大 50 |
| GET | `/api/edu/news/refresh` | 手动触发一次采集，默认后台执行；加 `?wait=1` 同步返回采集统计 |

返回字段：`id`、`title`、`content`、`source`、`publish_time`、`category`、`url`。
其中 `content` 是 Markdown 文档（图片已是 OSS 地址），前端按 Markdown 渲染即可。

### 采集链路（注册给 agent 的 tools）

1. `listEducationNews`：无头浏览器打开传入的列表页（站点地址来自 prompt），取最新 N 条，并标记该条是否已经入库
2. `fetchArticle`：打开详情页，把正文 HTML 转成 **Markdown**，返回标题、正文、来源、新闻时间、正文配图地址
3. `uploadImageToOss`：**绑定现有 `OssService`**，图片下载走浏览器上下文（带 referer 绕过防盗链）后上传
4. `saveEduNews`：写入 `edu_news`；标题 / 正文 / 来源 / 时间一律取详情页原文，`url` 唯一索引去重

### 正文格式与图片占位符

- `edu_news.content` 存的是 **Markdown 文档**（标题层级、加粗、列表、表格、链接都保留），
  `fetchArticle` 用 `turndown` 把正文 HTML 转成 Markdown，顶部的来源 / 作者 / 时间行、
  分享条、相关推荐、栏目导航会被清掉。
- 正文里的图片位置在抓取阶段先用占位符占位：`[[IMG_1]]`、`[[IMG_2]]` …
  序号对应 `fetchArticle` 返回的 `images` 数组下标 +1。
- 入库前（`saveArticle`）依次把每张图下载后经 `OssService` 上传，
  **用 `OssService.mainDomain` 拼出最终地址**，再把占位符替换成标准 Markdown 图片语法：
  `![图片](https://fms.whalepea.com/edu-news/edu_news_<内容md5>.png)`。
- 所以 `content` 入库后不会残留占位符；图片地址只存在 `content` 里，表里不再单独存 `images` 字段。
- 上传失败的图会被直接去掉（连占位符一起删），不影响这条新闻入库。
- 站点广告图、栏目图标、正文以外的小图在抓取阶段就会被过滤，不会出现在 Markdown 里。

agent 正常跑完却一条都没入库时，会尊重它的判断（认为都不是政策新闻）；
只有 agent 报错或压根没打开详情页时，才用政策关键词兜底，避免整天一条数据都没有。

### 配置（`src/config/config.default.ts` 的 `eduNews`）

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 定时任务开关，`config.local.ts` 里本地置为 `false` |
| `fetchLimit` | `20` | 每个站点列表页取多少条 |
| `maxFetchPerRun` | `30` | 每轮最多打开多少个详情页（站点合计） |
| `maxSavePerRun` | `10` | 每轮最多入库多少条 |
| `headless` | `true` | 无头模式 |
| `launchArgs` | `['--no-sandbox', '--disable-dev-shm-usage']` | 浏览器启动参数 |
| `timeout` / `runTimeoutMs` | `30000` / `600000` | 单页超时 / 一轮软超时 |
| `ossFolder` | `edu-news/` | 图片在 OSS 的目录，文件名用图片内容 md5，重复采集不会产生新对象 |
| `model` / `baseUrl` | `deepseek-chat` / `https://api.deepseek.com/v1` | 复用 `deepseek.appId` |

定时任务的 cron 表达式写在 `src/task/EduNewsTask.ts`（`0 0 6,18 * * *`，时区 `Asia/Shanghai`）。
线上 `pm2 -i 4` 会有 4 个 worker 各触发一次，任务里用 `NODE_APP_INSTANCE === '0'` 做了单实例守卫，
再加 `url` 唯一索引兜底，不会重复入库。

### 手动验证

```bash
# 本地默认关掉了定时任务，可以手动触发一轮并等结果
$ curl 'http://localhost:7001/api/edu/news/refresh?wait=1'

# 查看最新 10 条
$ curl 'http://localhost:7001/api/edu/news'
```

### 日志

采集过程会按步骤打印在控制台（同时写入 `logs/` 下的日志文件），agent 每一步都能看到：

```
[eduNews] ===== 开始采集（触发方式：manual）=====
[eduNews] agent 已启动，开始按步骤执行（模型 / 工具调用会逐步打印）
[eduNews] ── step 1 ── 🧠 调用模型 ChatOpenAI…
[eduNews] ── step 1 ── 🧠 模型返回（0.6s）
[eduNews]    💬 说明：三个站点列表已获取，未入库 10 条，按时间从新到旧处理。
[eduNews]    🔧 决定调用：listEducationNews({"url":"https://www.gaokao.com/baokao/yxdq/gkxxs/","limit":20})
[eduNews] ── step 2 ── ▶ 执行工具 listEducationNews({"url":"https://www.gaokao.com/..."})
[eduNews] 列表页抓取完成（www.gaokao.com）：共 20 条，其中 8 条已入库，12 条待处理
[eduNews]   1. 2026-06-01 2026年北京普通高等学校艺术类专业招生工作实施办法：报名和考试
[eduNews]   2. 2026-06-01 2026年北京普通高等学校艺术类专业招生工作实施办法：志愿填报（已入库）
[eduNews]    🔧 决定调用：fetchArticle({"url":"https://www.gaokao.com/e/20260601/..."})
[eduNews] ── step 2 ── ▶ 执行工具 fetchArticle({"url":"https://edu.youth.cn/wzlb/..."})
[eduNews] 详情页解析完成：2026年北京普通高等学校艺术类专业招生工作实施办法：报名和考试｜来源 高考网｜2026-06-01 09:27:14｜正文 760 字｜配图 0 张
[eduNews] ── step 2 ── ✅ 工具返回（0.8s）：{"ok":true,"title":"云南出台新规…"}
[eduNews] 入库成功 id=20｜2026年北京普通高等学校艺术类专业招生工作实施办法：报名和考试｜配图 0 张
[eduNews] agent 汇报：三个站点共扫描 60 条，入库 3 条，跳过 57 条。
[eduNews] ===== 采集完成：扫描 60 条，打开详情 6 条，入库 3 条，已存在 8 条，过滤 0 条，失败 0 条，上传图片 0 张，耗时 12.3s =====
```

含义：`🧠` 模型调用、`▶` 工具开始执行、`✅` 工具成功、`❌` 失败，每条都带 `step N` 序号和耗时。
列表页、详情页、图片上传、入库这些业务动作也会各打一行，单条日志过长会自动截断。
模型被要求用中文思考和汇报。

### 表结构（生产库 sync 关闭时手动执行）

（下面用 `utf8mb4`，避免新闻里的 emoji 存不进去；sequelize sync 默认按 `define.charset: 'utf8'` 建表。）

```sql
CREATE TABLE IF NOT EXISTS `edu_news` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(512) NOT NULL COMMENT '新闻标题',
  `publish_time` DATETIME NULL COMMENT '新闻时间（原文发稿时间）',
  `content` TEXT NOT NULL COMMENT '新闻主体（Markdown，图片为 OSS 地址）',
  `source` VARCHAR(128) NOT NULL DEFAULT '' COMMENT '新闻来源',
  `url` VARCHAR(512) NOT NULL COMMENT '原文链接，唯一索引用于去重',
  `category` VARCHAR(64) NOT NULL DEFAULT '教育政策' COMMENT '分类',
  `available` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否可用，默认 true',
  `collected_at` DATETIME NULL COMMENT '采集入库时间',
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_edu_news_url` (`url`),
  KEY `idx_edu_news_publish_time` (`publish_time`),
  KEY `idx_edu_news_available` (`available`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 注意事项

- 需要 Node 20+，且 `npm i` 后 Playwright 的浏览器可用（缺失时执行 `npx playwright install chromium`）。
- 采集一轮要跑几分钟（取决于新闻条数和模型速度），接口默认后台执行，用日志确认结果。
- 受限沙箱 / 容器里 chromium 多进程启动可能被拒，代码会自动降级到 `--single-process` 重试一次。
- 已存在的库升级时，模型里去掉的字段 sequelize 不会自动删，需要手动执行
  `ALTER TABLE edu_news DROP COLUMN images;`（图片地址已经在 content 里，不会丢内容）。

### 部署

```bash
$ npm start
$ npm stop
```

### 内置指令

- 使用 `npm run lint` 来做代码风格检查。
- 使用 `npm test` 来执行单元测试。


[midway]: https://midwayjs.org
