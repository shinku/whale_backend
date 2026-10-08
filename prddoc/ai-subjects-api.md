# AI 出题接口对接文档（/api/ai/subjects）

## 1. 接口概述

该接口用于「按配置直接出题」：调用方在请求体里同时传入配置对象 `config` 和系统提示词 `prompt`，
服务端把 `config` 序列化后作为用户输入、把 `prompt` 作为 System Prompt 发给 DeepSeek 大模型，
最终返回模型生成的纯文本内容（题目、作文等）。

它是 `POST /api/ai/activity` 的替代接口：老接口通过 `actId` 从服务端读取提示词，
新接口由调用方直接携带提示词，无需服务端预置 `${actId}.md` 文件。

| 项 | 说明 |
| --- | --- |
| 请求方式 | `POST` |
| 请求路径 | `/api/ai/subjects` |
| Content-Type | `application/json` |
| 鉴权 | 无（该路由未挂鉴权中间件） |
| 响应格式 | `application/json; charset=utf-8` |
| 是否流式 | 否，一次性返回完整结果 |
| 服务端超时 | 未单独设置，取决于 DeepSeek 应答（固定 `max_tokens=2048`） |

> 路径说明：控制器使用 `@Api('/ai')` 装饰，实际前缀为 `/api`，因此对外路径是 `/api/ai/subjects`。
> 对应源码：`src/controller/ai.ts`（`@Post('/subjects')`）、`src/service/AiService.ts`（`chatWithDeepSeek`）。

## 2. 请求参数

请求体为 JSON 对象，`config` 与 `prompt` 均为必填：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `config` | object | 是 | 出题配置（年级、题型、题量等）。服务端执行 `JSON.stringify(config)` 后作为**用户消息**发给模型 |
| `prompt` | string | 是 | 系统提示词（System Prompt），决定模型角色与输出格式 |

校验规则：两个字段都必须为「真值」。任意一个缺失、为 `null`、空字符串 `""`、`0`、`false` 都会直接报错，
返回 `{"status":404,"message":"config and prompt are required"}`（HTTP 状态码 500）。

### 参数语义

```
system 消息 = prompt
user   消息 = JSON.stringify(config)
```

服务端不校验 `config` 内部字段，各字段含义完全由 `prompt` 正文约定，字段拼写错误不会被拦截。

## 3. 请求示例

### 3.1 curl

```bash
curl -X POST 'http://localhost:7001/api/ai/subjects' \
  -H 'Content-Type: application/json' \
  -d '{
    "config": {
      "grade": "二年级上册",
      "type": "fill_blank",
      "count": 5
    },
    "prompt": "你是一位资深小学语文老师，专门为小学生出成语练习题。请根据我提供的 JSON 配置生成练习题，只输出题目本身。"
  }'
```

### 3.2 前端调用（fetch）

```js
const res = await fetch('/api/ai/subjects', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    config: { level: 'medium', type: ['fill_blank', 'choose_by_meaning'], count: 10 },
    prompt: '你是一位资深小学语文老师，专门为小学生出成语练习题……只输出练习题本身。',
  }),
});
const json = await res.json();
console.log(json.data); // 模型返回的纯文本内容
```

## 4. 响应说明

### 4.1 成功响应

控制器直接返回 `chatWithDeepSeek` 的结果（字符串），由全局中间件统一包装为：

```json
{
  "status": 200,
  "data": "1. 守株__兔\n\n2. 亡羊__牢\n\n3. 掩耳__铃"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | number | 业务状态码，成功固定为 `200` |
| `data` | string | 大模型返回的完整文本，具体格式由 `prompt` 约定 |

> `data` 是**纯文本字符串**，不是结构化 JSON。调用方若需要结构化题目，
> 需按 `prompt` 约定的输出格式自行解析（例如按行/按空行拆分），并做好模型输出不合规时的容错。

### 4.2 异常情况

| 场景 | HTTP 状态码 | 响应体 |
| --- | --- | --- |
| `config` 或 `prompt` 缺失/为空 | 500 | `{"status":404,"message":"config and prompt are required"}` |
| DeepSeek 调用失败（网络/额度/超时） | 500 | `{"status":404,"message":"Failed to get response from DeepSeek API"}` |

> 该接口没有独立的业务错误码封装：错误时 HTTP 状态码为 500，但响应体里的 `status` 字段是 404（全局中间件历史行为）。
> 调用方应同时判断 HTTP 200 与 `body.status === 200`，不要只看 `body.status`。
> 服务端日志中会输出 `DeepSeek API Error: ...`，可用于排查。

## 5. 模型参数（后端固定，不可通过本接口传入）

| 参数 | 固定值 |
| --- | --- |
| `model` | `deepseek-chat` |
| `temperature` | `0.7` |
| `max_tokens` | `2048` |

如需调参，需修改 `src/service/AiService.ts` 中 `chatCompletion` 的调用方式。

## 6. 注意事项

1. **超时设置**：接口同步等待模型生成，耗时通常在数秒到数十秒。前端/网关超时建议不低于 60s，
   避免题量较大时被提前断开。
2. **System Prompt 的传递方式**：`prompt` 被赋值到 `DeepSeekClient` 实例的 `systemPrompt` 属性上，
   而不是作为参数直接传入模型调用。`AIService` 使用 Midway 默认的 Request 作用域
   （`@Provide()` 未指定 scope，框架 `bind()` 的默认 scope 是 `Request`），每个请求持有独立实例，
   因此**不存在跨请求串词问题**。但要注意两点：
   - 同一请求内，若后续调用不传 `systemPrompt`，会复用上一次设置的值（实测确认）。
     `/api/ai/subjects` 强制要求传 `prompt`，所以不受影响；老接口 `POST /api/ai/activity` 不传 `prompt` 时走服务端文件，也不受影响。
   - 若将来给 `AIService` 加 `@Singleton()` 或改为单例，「不传 prompt 时复用上一次的值」就会变成跨请求泄漏，
     届时需改为每次调用显式传参。
3. **无鉴权与频控**：接口未做登录与频率校验，暴露公网前需在网关或中间件层补充。
4. **无重试与降级**：DeepSeek 调用失败时接口直接返回 500，重试需调用方自行实现。
5. **`config` 语义由提示词决定**：服务端只做 `JSON.stringify`，不校验字段。

## 7. 相关接口

`GET /api/ai/activity`（获取服务端内置提示词列表）与 `POST /api/ai/activity`（老接口，按 `actId` 出题）
详见 [`prddoc/ai-activity-api.md`](./ai-activity-api.md)。
