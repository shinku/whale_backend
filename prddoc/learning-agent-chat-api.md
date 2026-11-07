# AI 学习助手聊天接口（React / H5 对接文档）

该接口基于 Qwen3.7 / DeepSeek + DeepAgent，提供面向小学到高中学生的学习辅导、学习计划、出题与答案核验能力。服务端通过 Server-Sent Events（SSE）输出工具执行过程和最终 Markdown 回答，不向前端返回 thinking 过程。

## 1. 接口概览

| 项目     | 内容                                        |
| -------- | ------------------------------------------- |
| 请求路径 | `POST /api/ai/agent/chat`                   |
| 请求格式 | `application/json`                          |
| 返回格式 | `text/event-stream; charset=utf-8`          |
| 用户身份 | `x-user-id: <openid>`                       |
| 可选分组 | `x-lane: whale`，默认 `whale`               |
| 超时时间 | 服务端最长约 5 分钟                         |
| 输出格式 | execution、answer 为 Markdown                    |

当前版本只接受 `x-user-id`，并会查询用户表校验 openid 是否有效；不接受
`x-openid` 作为替代字段。后续切换 token 或网关注入身份时会统一调整这一层验证。
生产环境中仍应确保 `x-user-id` 由可信网关写入，不能直接采用浏览器用户任意填写的值。

## 2. 请求

```http
POST /api/ai/agent/chat
Content-Type: application/json
x-user-id: oX9xxxxxxxxxxxx
Accept: text/event-stream

{
  "message": "帮我制定一周的初二数学复习计划",
  "imageBase64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "history": [
    {
      "role": "user",
      "content": "我下周有期中考试"
    },
    {
      "role": "assistant",
      "content": "你希望重点复习哪些章节？"
    }
  ]
}
```

字段说明：

| 字段             | 必填 | 说明                                                    |
| ---------------- | ---- | ------------------------------------------------------- |
| `message`        | 是   | 用户本轮消息，最多 8000 字符                            |
| `imageBase64`    | 否   | 最多一张题目图片，支持 Data URL 或裸 Base64，最大 10MB   |
| `history`        | 否   | 最近对话，最多采用最后 20 条；单条最多 8000 字符         |

`history` 由前端提交，但不会每轮直接拼进模型上下文。服务端会把它作为当前 Agent
的只读历史工具数据；只有 Agent 判断用户提到此前内容、上一题或需要延续旧计划时，
才调用 `read_chat_history` 按关键词或最近条数读取，从而避免每轮重复消耗历史 token。

图片只作用于当前这一轮消息，不支持在 `history` 中携带图片。裸 Base64 会自动按
JPG 处理；更推荐传 `data:image/jpeg;base64,...`、`data:image/png;base64,...`
等完整 Data URL。目前支持 JPG、PNG、GIF、WebP。

## 3. SSE 事件协议

每个 SSE 帧都包含事件名和 JSON 数据：

```text
event: answer
data: {"type":"answer","content":"## 解题思路\n\n...","format":"markdown"}

```

事件类型：

| `event` / `type` | 说明                                               |
| ---------------- | -------------------------------------------------- |
| `session`        | 会话开始，返回 `requestId` 和用户摘要                    |
| `execution`      | DeepAgent 工具或计划执行过程，带 `stage` 和 `tool`  |
| `answer`         | 最终回答的 Markdown 文本片段                        |
| `done`           | 本次回答正常结束                                    |
| `error`          | 建流后的执行错误                                    |

### 3.1 session

```text
event: session
data: {"type":"session","requestId":"...","userId":"...","user":{"userName":"小明","vipType":"monthly","vipActive":true},"format":"json"}
```

### 3.2 execution

```text
event: execution
data: {"type":"execution","stage":"start","tool":"collect_wrong_questions","content":"正在执行 **collect_wrong_questions**","format":"markdown"}
```

`stage`：

- `start`：工具或任务开始。
- `end`：工具执行完成。
- `error`：工具执行失败。
- `note`：Agent 执行过程中的说明。

执行记录按照 SSE 到达顺序追加到时间线即可。

### 3.3 answer

```text
event: answer
data: {"type":"answer","content":"## 解题思路\n\n先求导","format":"markdown"}
```

所有 `answer.content` 按顺序拼接后就是完整的 Markdown 回答。片段边界可能落在 Markdown 语法中间，因此必须拼接完整字符串后再渲染，不能逐个片段单独渲染。

### 3.4 done / error

```text
event: done
data: {"type":"done","requestId":"...","durationMs":12345}

event: error
data: {"type":"error","status":500,"code":"AGENT_EXECUTION_FAILED","message":"学习助手执行失败"}
```

鉴权失败、请求体格式错误等建流前错误仍返回普通 JSON：

```json
{
  "status": 401,
  "message": "请先登录"
}
```

## 4. React 流式请求示例

### 4.1 推荐依赖

```bash
npm install react-markdown remark-gfm remark-math rehype-katex katex
npm install rehype-highlight highlight.js
```

用途：

| 依赖               | 用途                                           |
| ------------------ | ---------------------------------------------- |
| `react-markdown`   | 将流式拼接后的 Markdown 渲染为 React 节点      |
| `remark-gfm`       | 表格、任务列表、删除线等 GitHub Markdown 扩展  |
| `remark-math`      | 识别 `$...$` 和 `$$...$$` 数学公式             |
| `rehype-katex`     | 使用 KaTeX 渲染公式                            |
| `katex`            | KaTeX 样式和字体                               |
| `rehype-highlight` | 代码块高亮                                     |
| `highlight.js`     | 代码高亮主题                                   |

数学辅导场景建议必须包含 KaTeX。代码高亮可以按产品需要启用。

### 4.2 流式读取

浏览器 `fetch()` 的 `response.body` 是 `ReadableStream<Uint8Array>`。不要直接调用 `response.arrayBuffer()`，因为它会等待整个响应结束后才返回，失去流式效果。应逐块读取 Uint8Array，再用 `TextDecoder({ stream: true })` 解码。

```ts
export type AgentEvent =
  | { type: 'session'; requestId: string }
  | {
      type: 'execution';
      stage: 'start' | 'end' | 'error' | 'note';
      tool?: string;
      content: string;
      format: 'markdown';
    }
  | { type: 'answer'; content: string; format: 'markdown' }
  | { type: 'done'; requestId: string; durationMs: number }
  | {
      type: 'error';
      status: number;
      code?: string;
      message: string;
    };

export async function streamAgentChat(options: {
  baseURL: string;
  openid: string;
  message: string;
  imageBase64?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  signal?: AbortSignal;
  onEvent: (event: AgentEvent) => void;
}) {
  const response = await fetch(`${options.baseURL}/api/ai/agent/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'x-user-id': options.openid,
    },
    body: JSON.stringify({
      message: options.message,
      imageBase64: options.imageBase64,
      history: options.history,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || `请求失败：HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error('当前浏览器不支持 ReadableStream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const dispatch = (frame: string) => {
    let eventName = 'message';
    const dataLines: string[] = [];
    frame.split('\n').forEach(line => {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    });
    if (!dataLines.length) return;
    const data = JSON.parse(dataLines.join('\n')) as AgentEvent;
    options.onEvent({ ...data, type: (data.type || eventName) as any });
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // value 是 Uint8Array，可以继续转成 ArrayBuffer 或直接交给 TextDecoder。
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (frame.trim()) dispatch(frame);
      boundary = buffer.indexOf('\n\n');
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) dispatch(buffer);
}
```

### 4.3 React 状态合并

```tsx
import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';

export function LearningChat(props: {
  openid: string;
  baseURL: string;
}) {
  const [answer, setAnswer] = useState('');
  const [executions, setExecutions] = useState<
    Array<{ stage: string; tool?: string; content: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  async function send(message: string) {
    setThinking('');
    setAnswer('');
    setExecutions([]);
    setError('');
    setLoading(true);
    abortRef.current = new AbortController();

    try {
      await streamAgentChat({
        baseURL: props.baseURL,
        openid: props.openid,
        message,
        signal: abortRef.current.signal,
        onEvent(event) {
          if (event.type === 'execution') {
            setExecutions(value => [...value, event]);
          } else if (event.type === 'answer') {
            setAnswer(value => value + event.content);
          } else if (event.type === 'error') {
            setError(event.message);
          }
        },
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {executions.length > 0 && (
        <ol>
          {executions.map((item, index) => (
            <li key={index}>
              <strong>{item.tool || item.stage}</strong>
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]}>
                {item.content}
              </ReactMarkdown>
            </li>
          ))}
        </ol>
      )}

      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
      >
        {answer}
      </ReactMarkdown>

      {error && <p role="alert">{error}</p>}
      {loading && <p>助手正在思考...</p>}
      <button type="button" onClick={() => abortRef.current?.abort()}>
        停止生成
      </button>
    </div>
  );
}
```

## 5. Markdown 展示建议

- `react-markdown` 默认不执行 HTML，安全策略更简单；不要开启 `rehype-raw`，除非另有 DOMPurify 等清洗。
- 公式使用 `remark-math + rehype-katex`，并引入 `katex/dist/katex.min.css`。
- 代码块使用 `rehype-highlight`，按主题引入对应 CSS。
- 表格使用 `remark-gfm`。
- 流式期间只更新状态，不要在每次 token 到达时做数据库写入或昂贵布局计算。
- 对长会话建议给 execution 设置最大高度、滚动和折叠，避免挤占答案区域。
- `answer` 片段可能切在 Markdown 标记中间，必须拼接字符串后整体传给 `ReactMarkdown`。

### 5.1 英语朗读标记

英语学习内容中的可朗读词汇会使用以下格式：

```markdown
[pronounce:hero] /ˈhɪərəʊ/
```

短语示例：

```markdown
[pronounce:good morning] /ɡʊd ˈmɔːnɪŋ/
```

完整句子示例：

```markdown
[pronounce:The cat is sleeping.] /ðə kæt ɪz ˈsliːpɪŋ/
```

标记中的内容可以是一个单词、短语或完整英文句子，后面的 `/.../` 是 IPA 音标。超过 500 个字符的长文本会拆成多个完整句子分别标记。前端可以把标记转换成可点击按钮，并使用浏览器 Web Speech API：

```ts
function speakEnglish(text: string) {
  if (!('speechSynthesis' in window)) {
    throw new Error('当前浏览器不支持语音朗读');
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}
```

使用 `react-markdown` 时，可以在渲染前把朗读标记转换成内部链接：

```tsx
function preparePronounceMarkdown(markdown: string) {
  return markdown.replace(
    /\[pronounce:([^\]\r\n]{1,500})\]/g,
    (_match, text) => `[${text}](pronounce:${encodeURIComponent(text)})`
  );
}

<ReactMarkdown
  remarkPlugins={[remarkGfm, remarkMath]}
  rehypePlugins={[rehypeKatex, rehypeHighlight]}
  components={{
    a({ href, children }) {
      if (href?.startsWith('pronounce:')) {
        const text = decodeURIComponent(href.slice('pronounce:'.length));
        return (
          <button type="button" onClick={() => speakEnglish(text)}>
            {children}
          </button>
        );
      }
      return <a href={href}>{children}</a>;
    },
  }}
>
  {preparePronounceMarkdown(answer)}
</ReactMarkdown>
```

严谨场景建议用 remark 插件在 AST 层处理朗读标记，避免简单字符串替换误伤 fenced code block 或行内代码。

## 6. DeepAgent 文件系统与沙箱边界

Agent 使用 `FilesystemBackend`，不使用 `LocalShellBackend`：

- 每个 `openid` 使用独立目录：
  `output/learning-agent/<sha256>/`。
- `virtualMode: true`：模型看到的 `/` 只会映射到该会话目录，不是主机根目录。
- `..`、`~`、越出根目录的路径会被 SDK 拒绝。
- 指向沙箱外部的 symlink 会被拒绝。
- 显式权限规则先拒绝 `/etc/**`、`/proc/**`、`/Users/**`、`/private/**`、`/System/**`、`/usr/**` 等系统路径，再允许会话虚拟根内的其他读写。
- 后端不支持 `execute`，因此不会向 Agent 注册 shell 命令工具。
- 文件大小上限为 5MB。
- DeepAgent 子 Agent 继承相同 backend 和 permission 规则。

模型不能读取项目源码、服务端配置、密钥、用户 home 目录或其他会话的文件。

## 7. DeepAgent 工具

Agent 当前可使用：

| 工具                        | 用途                                      |
| --------------------------- | ----------------------------------------- |
| `read_chat_history`         | 按需读取历史聊天记录，默认返回最近 6 条   |
| `collect_wrong_questions`   | 识别错题区域，封装原错题收集接口          |
| `clear_handwriting`         | 清除手写笔迹并上传干净图片                |
| `images_to_pdf`             | 多张题目图片合成 PDF                      |
| `markdown_to_word`          | 学习计划、试卷和辅导材料导出 Word         |
| `convert_pdf_to_word`       | PDF 转 Word                               |
| `list_my_uploaded_files`    | 查询当前用户最近生成的文件                |

文件类工具仍受现有用户次数限制。Agent 的文件系统沙箱位于当前项目 `output/learning-agent/` 下，并按用户和会话隔离，不能访问项目源码、配置或沙箱外路径。

## 8. 前端接入注意事项

- 使用 POST SSE，不能使用浏览器原生 `EventSource`，因为它只支持 GET 且不能自定义请求体。
- 使用 `AbortController` 支持“停止生成”。
- SSE 连接失败后由用户主动重试；不要无限自动重连，避免重复执行文件工具。
- 收到 `error` 后停止合并 answer 和 execution，保留已有内容供用户查看。
- `userOrinted` 完全由服务端签名 HttpOnly Cookie session 的 `user_orinted` 字段维护，并在 SSE 开始前生成；前端无需提交会话 ID，也无需读取、接收或回传该字段。详见 [userOrinted 会话状态说明](./aichat-user-orinted.md)。
- 最终内容必须按 Markdown 渲染，数学题需要启用 KaTeX。
- 用户切换会话时终止旧的 fetch 请求。
