# AI Chat userOrinted 会话状态说明

`userOrinted` 是服务端维护的隐藏状态，用来记录用户当前正在做的学习任务。前端不需要接收、展示或回传该字段。

## 1. 会话标识

前端不需要提交会话 ID，只需要正常携带 HttpOnly Cookie：

```json
{
  "message": "继续下一题",
  "history": []
}
```

服务端把 `userOrinted` 保存在 Koa/Egg 的签名 HttpOnly Cookie session 中，
Cookie 字段名为 `user_orinted`，值为英文，最多 500 字，有效期 7 天。

## 2. 自动生成和更新

- 服务端会在 SSE 开始前把已保存的 `user_orinted`、最近的 user 历史消息和当前消息一起交给 DeepSeek。
- 如果判断用户没有明确切换任务，DeepSeek 必须原样返回已保存的 `user_orinted`。
- 如果判断出现新任务，返回新的英文摘要。
- 摘要必须在 SSE 之前写入 Cookie，再启动 Agent SSE。
- 历史不足时，使用当前用户消息生成兜底摘要。
- 因为摘要发生在 SSE 之前，`Set-Cookie` 会随正常响应头提交，不会出现流开始后无法写 Cookie 的问题。

## 3. 前端行为

- 不需要从 SSE 中读取 `userOrinted`。
- 不需要在下一次 POST 中回传。
- HttpOnly Cookie 由浏览器自动携带，前端无法也不需要直接读取。
- 不要将 `userOrinted` 渲染到聊天气泡、thinking 或 execution 区域。
- 只需要持续使用同一个 `x-user-id`。
- 如果 H5 与 API 跨域，浏览器要求 fetch 使用 `credentials: 'include'`；这是浏览器传输配置，不需要作为业务请求字段提交。

## 4. 模型选择

- 请求没有图片：使用 `DeepSeekService` 驱动 Agent。
- 请求带 `imageBase64`：使用 Qwen 多模态模型识别图片并驱动 Agent。
