# my-midway-project

## 快速入门

如需进一步了解，参见 [midway 文档][midway]。

### 环境要求

- Node.js `>= 12`（建议 18 及以上）
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

### 部署

```bash
$ npm start
$ npm stop
```

### 内置指令

- 使用 `npm run lint` 来做代码风格检查。
- 使用 `npm test` 来执行单元测试。


[midway]: https://midwayjs.org
