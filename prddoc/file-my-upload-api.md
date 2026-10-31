# 我的文件列表接口对接文档（/api/file/myupload）

## 1. 接口概述

该接口用于分页查询当前用户通过文件转换、题目检测等操作生成的文件记录，按记录 ID 倒序返回，最新文件在前。

| 项 | 说明 |
| --- | --- |
| 请求方式 | `GET` |
| 请求路径 | `/api/file/myupload` |
| 鉴权 | 必须携带请求头 `x-user-id`（用户 openid） |
| 响应格式 | `application/json; charset=utf-8` |
| 返回内容 | 文件总数、分页信息和文件列表 |

> 实际路径由控制器 `@Api('/file')` 和 `@Get('/myupload')` 组合而成。
> 对应源码：`src/controller/file.ts` 的 `getMyUpload`。

## 2. 请求参数

### 2.1 请求头

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `x-user-id` | 是 | 用户 openid，缺失时报 `userId is required` |

### 2.2 Query 参数

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `page` | number | 否 | `1` | 页码，从 1 开始 |
| `limit` | number | 否 | `20` | 每页数量，范围 1～50 |
| `offset` | number | 否 | `0` | 偏移量；传 `page` 时优先使用 `page` |
| `lane` | string | 否 | `whale` | 业务线 |

如果 `page`、`limit`、`offset` 不是有效整数，会使用默认值；`limit` 超过 50 时按 50 处理。

## 3. 请求示例

### 3.1 curl

```bash
curl 'http://localhost:7001/api/file/myupload?page=1&limit=20&lane=whale' \
  -H 'x-user-id: <用户openid>'
```

### 3.2 前端调用

```js
/**
 * @param {{ page?: number, limit?: number, lane?: string }} options
 * @returns {Promise<{
 *   status: number,
 *   count: number,
 *   list: Array<{
 *     id: number,
 *     file: string,
 *     image_url_after: string,
 *     url: string,
 *     lane: string,
 *     createdAt: string
 *   }>,
 *   page: number,
 *   limit: number,
 *   offset: number,
 *   hasMore: boolean
 * }>}
 */
async function getMyUploads({ page = 1, limit = 20, lane = 'whale' } = {}) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    lane,
  });
  const res = await fetch(`/api/file/myupload?${params}`, {
    headers: {
      'x-user-id': getUserId(),
    },
  });
  const json = await res.json();
  if (!res.ok || json.status !== 200) {
    throw new Error(json.message || '获取文件列表失败');
  }
  return json;
}
```

## 4. 响应说明

### 4.1 成功响应

```json
{
  "status": 200,
  "count": 32,
  "list": [
    {
      "id": 128,
      "file": "pub/1761283200000_42.7.pdf",
      "image_url_after": "pub/1761283200000_42.7.pdf",
      "url": "https://fms.whalepea.com/pub/1761283200000_42.7.pdf",
      "lane": "whale",
      "createdAt": "2026-10-24T08:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "offset": 0,
  "hasMore": true
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | number | 成功固定为 `200` |
| `count` | number | 当前用户、当前 lane 下的文件总数 |
| `list` | array | 当前页文件列表，按 ID 倒序 |
| `list[].id` | number | 文件记录 ID，可直接作为前端列表 key |
| `list[].file` | string | OSS 对象路径，例如 `pub/xxx.pdf` |
| `list[].image_url_after` | string | 兼容旧字段，值与 `file` 相同 |
| `list[].url` | string | 文件直链，可直接用于预览或下载 |
| `list[].lane` | string | 业务线 |
| `list[].createdAt` | string | 记录创建时间 |
| `page` | number | 当前页码 |
| `limit` | number | 当前每页数量 |
| `offset` | number | 当前偏移量 |
| `hasMore` | boolean | 是否还有下一页 |

### 4.2 异常响应

```json
{
  "status": 404,
  "message": "userId is required"
}
```

调用方应同时判断 HTTP `res.ok` 和响应体 `status === 200`。

## 5. 使用建议

1. 文件记录由转换接口成功后异步写入；刚完成转换时如果列表暂时没有新文件，可稍后刷新。
2. 列表展示建议使用 `url` 作为预览/下载地址，使用 `file` 作为业务对象路径。
3. 前端分页优先传 `page` 和 `limit`，`offset` 主要用于兼容旧调用方。
4. 当 `hasMore` 为 `false` 时停止加载下一页。
