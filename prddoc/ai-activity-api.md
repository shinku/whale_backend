# AI 活动内容生成接口对接文档

## 1. 接口概述

该接口用于「按活动类型生成内容」：调用方传入活动标识（`actId`）和该活动的配置对象（`config`），
服务端读取该活动对应的 System Prompt，把 `config` 序列化后作为用户输入发给 DeepSeek 大模型，
最终返回模型生成的纯文本内容（作文、题目等）。

| 项 | 说明 |
| --- | --- |
| 请求方式 | `POST` |
| 请求路径 | `/api/ai/activity` |
| Content-Type | `application/json; charset=utf-8` |
| 鉴权 | 无（接口本身不校验登录态，`x-user-id` 头仅被中间件透传，未参与业务逻辑） |
| 响应格式 | `application/json` |
| 是否流式 | 否，一次性返回完整结果 |
| 服务端超时 | 未单独设置，取决于 DeepSeek 应答（默认 `max_tokens=2048`） |

> 路径说明：控制器使用 `@Api('/ai')` 装饰，实际前缀为 `/api`，因此对外路径是 `/api/ai/activity`。

## 2. 请求参数

请求体为 JSON 对象：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `actId` | string | 条件必填 | 活动标识，对应 `src/prompts/{actId}.md` 提示词文件。当请求体携带 `prompt` 时，`actId` 可不传 |
| `config` | object | 是 | 该活动的配置项，服务端会执行 `JSON.stringify(config)` 作为用户消息内容 |
| `prompt` | string | 否 | 自定义 System Prompt。传入后会**覆盖** `actId` 对应的提示词文件，优先级高于 `actId` |

### 参数优先级

```
systemPrompt = prompt || 读取(src/prompts/{actId}.md)
```

- 只传 `prompt`：使用自定义提示词，无需 `actId`。
- 只传 `actId`：使用仓库内的提示词文件。
- 两者都传：以 `prompt` 为准，`actId` 被忽略。
- 两者都不传：服务端抛出 `prompt file not found: undefined.md`。

### 支持的 actId

可通过 `GET /api/ai/activity` 获取当前可用列表，当前仓库内置：

| actId | 用途 | config 建议字段 |
| --- | --- | --- |
| `aiwriter` | 作文生成 | `topic`（主题）、`extra`（要求）、`type`（文体）、`language`（语言）、`count`/`wordCount`（字数） |
| `math` | 口算题生成 | 提示内容（自然语言描述即可，无强约束字段） |
| `vertical_calc` | 竖式计算题生成 | `version`/`textbookVersion`（教材版本，默认苏教版）、`grade`（年级，如“二年级上册”）、`type`/`range`（题型范围）、`count`（题量） |
| `idiom_practice` | 成语练习生成 | `level`（难度：`easy`/`medium`/`hard`，也可传中文）、`type`（题型：`fill_blank`/`choose_by_meaning`，可为数组）、`count`（题量，默认 5，最大 20） |
| `word_practice` | 英语单词练习生成 | `textbookVersion`/`version`（教材版本）、`grade`（年级）、`unit`（单元，可选）、`type`（`英译中`/`中译英`，可为数组）、`count`（题量，默认 15，最大 50） |

> `config` 各字段的具体取值规则以 `${actId}.md` 提示词正文为准，上表为摘要。
> 新增活动只需在 `src/prompts/` 下新增 `${actId}.md`，无需改代码。

## 3. 请求示例

### 3.1 作文生成（actId 方式）

```bash
curl -X POST 'http://localhost:7001/api/ai/activity' \
  -H 'Content-Type: application/json' \
  -d '{
    "actId": "aiwriter",
    "config": {
      "topic": "我的暑假",
      "extra": "写出真情实感",
      "type": "记叙文",
      "language": "中文",
      "count": 500
    }
  }'
```

### 3.2 竖式计算题（actId 方式）

```bash
curl -X POST 'http://localhost:7001/api/ai/activity' \
  -H 'Content-Type: application/json' \
  -d '{
    "actId": "vertical_calc",
    "config": {
      "textbookVersion": "苏教版",
      "grade": "二年级上册",
      "count": 10
    }
  }'
```

### 3.3 自定义提示词（prompt 方式）

```bash
curl -X POST 'http://localhost:7001/api/ai/activity' \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "你是一个语文老师，只输出结果，不要多余解释。",
    "config": { "topic": "春天" }
  }'
```

### 3.4 前端调用（fetch）

```js
const res = await fetch('/api/ai/activity', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    actId: 'idiom_practice',
    config: { level: 'medium', type: ['fill_blank', 'choose_by_meaning'], count: 10 },
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
  "data": "模型生成的内容（字符串）"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | number | 业务状态码，成功固定为 `200` |
| `data` | string | 大模型返回的完整文本，内容格式由对应提示词决定 |

`data` 的具体格式随活动而定：

- `aiwriter` / `math` / `vertical_calc`：纯文本，多行内容以 `\n` 分隔。
- `idiom_practice`：纯文本，题目之间以空行分隔。
- `word_practice`：JSON **字符串**，调用方需再执行一次 `JSON.parse(data)` 得到题目数组。

### 4.2 作文生成响应示例

```json
{
  "status": 200,
  "data": "我的暑假\n\n暑假的第一天，阳光透过窗帘……"
}
```

### 4.3 word_practice 响应示例

```json
{
  "status": 200,
  "data": "[{\"label\":\"apple\",\"phonetic\":\"/ˈæpl/\",\"options\":[{\"value\":\"A\",\"label\":\"苹果\",\"isCorrect\":true},{\"value\":\"B\",\"label\":\"香蕉\",\"isCorrect\":false},{\"value\":\"C\",\"label\":\"梨\",\"isCorrect\":false}]}]"
}
```

### 4.4 异常情况

| 场景 | 表现 |
| --- | --- |
| `actId` 不存在或文件缺失 | 服务端抛出 `prompt file not found: {actId}.md` |
| `actId` 与 `prompt` 均未传 | 服务端抛出 `prompt file not found: undefined.md` |
| `config` 缺失 | 序列化为 `undefined` 发给模型，模型输出不可预期；调用方应始终传对象 |
| DeepSeek 调用失败（网络/额度/超时） | 服务端日志输出 `DeepSeek API Error: ...`，接口抛出 `Failed to get response from DeepSeek API` |

> 该接口当前没有业务错误码封装，异常时不会返回 `{ status, data }` 结构。
> 调用方需要按 HTTP 状态码、超时与空响应做兜底处理。

## 5. 相关接口

### GET /api/ai/activity

获取可用的活动（提示词）列表。

```bash
curl 'http://localhost:7001/api/ai/activity'
```

```json
{
  "status": 200,
  "data": ["aiwriter", "idiom_practice", "math", "vertical_calc", "word_practice"]
}
```

## 6. 注意事项

1. **并发竞态**：`DeepSeekClient` 是单例，`systemPrompt` 在每次请求时被覆盖写入。
   同一时刻并发调用不同 `actId`，可能出现 A 请求的 System Prompt 被 B 请求覆盖的问题。
   高并发场景建议改造为「每次请求独立客户端/显式传参」。
2. **无鉴权**：接口未做登录与频控校验，暴露公网前需在网关或中间件层补充。
3. **参数不可调**：`model`（固定 `deepseek-chat`）、`temperature`（默认 `0.7`）、`max_tokens`（默认 `2048`）均未开放给调用方。
4. **结果需二次处理**：除 `word_practice` 外，其余活动返回的是纯文本，前端需自行渲染；`word_practice` 需 `JSON.parse`，且模型输出不保证 100% 合法 JSON，建议加容错。
5. **`config` 语义由提示词决定**：服务端只做 `JSON.stringify`，不校验字段，字段拼写错误不会被拦截。
