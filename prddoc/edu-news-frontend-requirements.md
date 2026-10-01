# 教育新闻接口 → 前端需求文档

> 来源：`src/controller/edu.ts`、`src/service/NewsService.ts`、`src/model/EduNewsModel.ts`，
> 并通过 mock 应用实测接口返回。文档中所有字段、默认值、边界行为均以当前代码为准。
>
> 范围：**仅覆盖前端需要的新闻读取能力**。`/api/edu/news/refresh` 属于运营/运维动作，
> 不在前端需求范围内，本文不做约定。

## 一、接口契约（已实测确认）

接口在 `/api/edu` 前缀下，**没有挂任何登录中间件**，前端不需要带 token。

### 最新新闻列表

`GET /api/edu/news?limit=10`

响应示例：

```json
{
  "status": 200,
  "data": {
    "count": 2,
    "list": [
      {
        "id": 48,
        "title": "四川发布“十个不”护航师生网络安全",
        "content": "本报讯（记者 葛仁鑫）近日，四川省教育厅……",
        "source": "中国教育报",
        "publish_time": "2026-09-23T01:28:00.000Z",
        "category": "教育政策",
        "url": "https://edu.youth.cn/wzlb/202609/t20260923_16884240.htm"
      }
    ]
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | number | 固定 200，外层包装由全局 middleware 注入 |
| `data.count` | number | **本页条数**，等于 `list.length`，不是总数 |
| `data.list[].id` | number | 主键，可用于路由参数 |
| `data.list[].title` | string | 新闻标题 |
| `data.list[].content` | string | 正文，**Markdown 格式**，图片已是 OSS 绝对地址 |
| `data.list[].source` | string | 来源，**可能为空字符串** |
| `data.list[].publish_time` | string \| null | 原文发稿时间，ISO-8601（UTC），**可能为 null** |
| `data.list[].category` | string | 分类，当前默认恒为“教育政策” |
| `data.list[].url` | string | 原文链接 |

行为约定：

- 外层统一是 `{ status, data }`，业务数据在 `data` 里。
- **无分页、无 `total`、无 pageSize**，只能取“最新 N 条”。
- 只返回 `available = true` 的记录，下架数据不可见。
- `limit` 默认 10，只接受 1–50；**非法值或大于 50 会回退成 10**（不是截断到 50）。
- 排序后端已固定：`publish_time DESC, id DESC`。
- `content` 为 Markdown，图片形如 `![图片](https://fms.whalepea.com/edu-news/...)`；
  没有配图的新闻不含图片节点。
- `publish_time` 是 UTC 瞬时值，按 `Asia/Shanghai` 格式化后即为原文时间
  （后端 sequelize 时区为 `+08:00`）。
- 未暴露 `available`、`collected_at`、`createdAt` / `updatedAt`。

## 二、类型定义（可直接给前端使用）

```ts
export interface EduNewsItem {
  id: number;
  title: string;
  content: string;             // Markdown，图片为 OSS 绝对地址
  source: string;              // 可能为空字符串
  publish_time: string | null; // ISO 8601 UTC
  category: string;            // 默认“教育政策”
  url: string;                 // 原文链接
}

export interface EduNewsListRes {
  status: number;
  data: { count: number; list: EduNewsItem[] };
}
```

## 三、前端需求

### 3.1 数据层

1. 新增 API 封装模块，基地址通过环境变量注入。当前 `front/vite.config.ts`
   未配置 proxy，页面也尚无请求封装，需要先补 `VITE_API_BASE_URL` 或 `/api` 代理。
2. `limit` 由前端保证在 1–50 之间，不要依赖后端兜底。
3. 明确：**当前没有分页能力**。前端不做“下一页 / 加载更多”，
   需要更多只能把 `limit` 提到上限 50。

### 3.2 列表页

4. 每行展示：标题、来源、发布时间（格式化）、分类标签。
   `category` 目前恒为“教育政策”，可先预留标签位。
5. 不在前端重新排序，信任后端顺序。
6. 时间统一走 `formatTime(publish_time)`，`null` 显示“时间未知”，
   避免直接 `new Date(null)`。
7. 需要空态（无数据）与加载态。
8. 点击进入详情页（路由参数用 `id`）。

### 3.3 详情页

9. `content` 必须按 **Markdown 渲染**，且支持 GFM（列表、表格、加粗、链接），
   推荐 `react-markdown` + `remark-gfm`。
10. 必须做 XSS 防护，不要用 `dangerouslySetInnerHTML` 直接注入原始内容。
11. 图片设置 `max-width: 100%` 与 `loading="lazy"`，OSS 图片可直连。
12. 展示来源、发布时间、分类，并提供“查看原文”入口
    （跳转 `url`，`target="_blank"`）。

## 四、注意事项 / 已知风险

- **错误响应不统一**：全局 middleware 仅在 404 时返回
  `{ status: 404, message }`，其他异常基本被吞掉。
  前端不要依赖 `body.message` 做提示，按 HTTP 状态码兜底即可。
- **列表无法看到下架数据**：`available = false` 的记录接口不返回；
  若后台需要“下架 / 审核”，当前没有对应接口，需后端新增。
- **以下需求均需后端先加接口**：分页、搜索、按来源 / 分类筛选、
  按时间范围查询、单条详情接口（`/api/edu/news/:id`）、管理端全量列表。
  当前只有“最新 N 条”这一个读取入口。
