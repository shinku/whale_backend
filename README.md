# my-midway-project

## QuickStart

see [midway docs][midway] for more detail. (中文文档见 [README.zh-CN.md](./README.zh-CN.md))

### Requirements

- Node.js `>= 12` (18+ recommended)
- [Podman](https://podman.io) `>= 4.7` for the local MySQL container (macOS needs a podman machine)
- Python 3 (only for the Office / PDF scripts under `call_task/py`)

### Development

#### 1. Start the local database (Podman + MySQL 8)

[compose.yml](./compose.yml) mirrors `sequelize.dataSource.default` in `src/config/config.local.ts`:

| `config.local.ts` | `compose.yml` |
| --- | --- |
| `host: 127.0.0.1`, `port: 3306` | `ports: 127.0.0.1:3306:3306` |
| `database: whale_db` | `MYSQL_DATABASE: whale_db` |
| `username: root`, `password: STARKU0303` | `MYSQL_ROOT_PASSWORD: STARKU0303` |
| `timezone: '+08:00'` | `TZ=Asia/Shanghai` + `--default-time-zone=+08:00` |
| `dialect: mysql` | image `mysql:8.0` |
| `sync: true` | schema is created by sequelize on boot |

On macOS install Podman and initialize the machine once:

```bash
$ brew install podman podman-compose
$ podman machine init && podman machine start   # not needed on Linux
```

Then start the database container from the project root:

```bash
$ podman compose up -d
```

If pulling from docker.io is slow, create a `.env` in the project root (git-ignored) and
re-run the start command:

```bash
MYSQL_IMAGE=docker.m.daocloud.io/library/mysql:8.0
```

#### 2. Initialize the database (no manual DDL)

Everything happens inside the application — there is no init or migration script to run:

- **Schema**: `whale_db` is created by `MYSQL_DATABASE` on the container's first boot, so no
  `docker-entrypoint-initdb.d` SQL is needed.
- **Tables**: sequelize creates every table from `src/model/*.ts` on startup because
  `config.local.ts` sets `sync: true`, so just boot the app:

  ```bash
  $ npm i
  $ npm run dev
  ```

  Tables created on first boot: `user`, `user_point`, `user_point_consume_logs`,
  `user_vip_record`, `user_record_cleanpaper_image`, `user_feedback`, `user_limit_table`,
  `banner`, `prompt_act`, `app_info`, `app_operate`.

  The sync runs asynchronously while the app starts, so give it a moment before inspecting tables.

Verify with:

```bash
$ podman exec -it whale-mysql mysql -uroot -pSTARKU0303 whale_db -e 'show tables'
```

Or start the bundled Adminer UI with `podman compose --profile tools up -d` and open
<http://localhost:8080> (server `mysql`, user `root`, password `STARKU0303`, database `whale_db`).

#### 3. Run the app

`npm run dev` starts the backend (<http://localhost:7001>) and the `front/` Vite dev server
(<http://localhost:5173>) together.

### Database shortcuts

| Task | Command |
| --- | --- |
| Start / stop (keeps data) | `podman compose up -d` / `podman compose down` |
| Container status / logs | `podman ps` / `podman compose logs -f mysql` |
| Interactive mysql shell | `podman exec -it whale-mysql mysql -uroot -pSTARKU0303 whale_db` |
| Reset (drop and recreate) | `podman compose down -v` |
| Backup | `podman exec whale-mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --databases whale_db' > whale_db.sql` |
| Restore | `podman exec -i whale-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"' < whale_db.sql` |

> `podman compose down -v` deletes the volume and all data in it, and that cannot be recovered.
> Starting the container and the app again re-creates the schema and all tables automatically.

### Troubleshooting

- **Port 3306 already in use**: `lsof -nP -iTCP:3306 -sTCP:LISTEN`, then stop the process or change the
  port mapping in `compose.yml` (and `port` in `config.local.ts`).
- **Changed `compose.yml` values have no effect**: `MYSQL_DATABASE`, charset and friends only apply to
  an empty volume, so run `podman compose down -v && podman compose up -d`.
- **`ECONNREFUSED` from sequelize**: the container is not ready yet, wait until
  `podman compose logs -f mysql` prints `ready for connections` before booting the app.
- **`ER_ACCESS_DENIED_ERROR`**: MySQL 8 defaults to `caching_sha2_password`, which `mysql2` supports; if it
  still fails, append `--default-authentication-plugin=mysql_native_password` to `command` in
  `compose.yml` and run `podman compose down -v && podman compose up -d`.
- **Charset**: the server default is `utf8mb4`, but `define.charset: 'utf8'` in `config.local.ts`
  (aliased to `utf8mb3` in MySQL 8) makes the sequelize-managed tables reject emoji. Switch it to
  `utf8mb4` plus a volume reset if you need them.
- **Local config ignored**: `src/configuration.ts` overrides the config when `/config/config.json`
  exists (production images only). It normally does not exist locally, so `config.local.ts` applies;
  that file is git-ignored, so recreate it on a new machine.

### Deploy

```bash
$ npm start
$ npm stop
```

### npm scripts

- Use `npm run lint` to check code style.
- Use `npm test` to run unit test.


[midway]: https://midwayjs.org
