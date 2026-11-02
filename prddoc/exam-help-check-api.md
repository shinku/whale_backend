# 作业检查接口（小程序对接文档）

该接口接收一张作业图片，自动识别科目、题目和学生答案，返回逐题批改结果及题目在原图中的位置。

## 1. 接口概览

| 项目         | 内容                                             |
| ------------ | ------------------------------------------------ |
| 请求方式     | `POST`                                           |
| 请求路径     | `/api/exam/help_check`                           |
| 推荐提交方式 | JSON；小程序使用 `wx.request` 并开启分块接收     |
| 鉴权         | `Authorization: Bearer <accessToken>`            |
| 图片大小     | 最大 10MB                                        |
| 返回格式     | `text/event-stream; charset=utf-8`（SSE）        |
| 调用时长     | 依赖模型识别，可能超过 60 秒                     |

接口是单图、无状态调用：一次请求只提交一张图片，服务端不保存批改记录。多页作业需要逐页调用。

每个 VIP 用户每天有调用次数上限，默认 5 次，可通过服务端
`/config/extra_config.json` 的 `examCheckDailyLimit` 调整。达到上限后接口返回
HTTP `429`。次数只在该次 SSE 流结束后累加。

服务端通过 OpenAI SDK 流式消费 Qwen 的返回结果，并实时转发为 SSE 事件。
接口会先发送若干 `delta`，最后发送包含完整批改结果的 `done`；失败时发送 `error`。

当服务端的 VIP 校验开启时，必须使用登录接口签发的 token；会员过期时不能调用。即使当前未开启校验，小程序也建议始终携带 token，避免后续配置切换造成兼容问题。

## 2. 调用流程

1. 使用 `wx.login` 获取临时 `code`。
2. 调用 `POST /api/auth/wechat-login`，取得并缓存 `accessToken`。
3. 使用 `wx.chooseMedia` 选择或拍摄一张作业图片。
4. 使用 `wx.request` 并开启 `enableChunked`，实时处理 SSE 事件。
5. 收到 `done` 后根据 `questions` 展示批改结果；有坐标时叠加到原图上。

### 2.1 登录并获取 accessToken

```js
const API_BASE_URL = 'https://api.whalepea.com'; // 按实际环境修改

function loginWithWechat() {
  return new Promise((resolve, reject) => {
    wx.login({
      success({ code }) {
        wx.request({
          url: `${API_BASE_URL}/api/auth/wechat-login`,
          method: 'POST',
          data: { code },
          success({ statusCode, data: body }) {
            if (statusCode < 200 || statusCode >= 300 || body.status !== 200) {
              reject(new Error(body.message || '登录失败'));
              return;
            }
            wx.setStorageSync('accessToken', body.data.accessToken);
            resolve(body.data.accessToken);
          },
          fail: reject,
        });
      },
      fail: reject,
    });
  });
}
```

`accessToken` 会过期，建议同时保存返回的 `expiresIn`（单位：秒）。遇到 HTTP 401 时重新登录并重试一次。

## 3. 上传并检查作业

### 3.1 小程序流式请求

`wx.uploadFile` 不能通过 `onChunkReceived` 逐块接收响应，因此流式接入应使用
`wx.request({ enableChunked: true })`。本地图片需要先读成 Base64；图片已经上传到公网时，
更推荐直接传图片 URL。

```js
function createSseParser(onEvent) {
  let buffer = '';

  return function feed(text) {
    buffer += text;
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');

      let eventName = 'message';
      const dataLines = [];
      rawEvent.split('\n').forEach(line => {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      });
      if (dataLines.length) {
        onEvent(eventName, JSON.parse(dataLines.join('\n')));
      }
    }
  };
}
```

直接提交图片 URL 的示例：

```js
function checkExamStream(imageUrl, accessToken, onDelta) {
  return new Promise((resolve, reject) => {
    let result = null;
    let streamError = null;
    const decoder = new TextDecoder('utf-8');
    const feed = createSseParser((event, data) => {
      if (event === 'delta') {
        onDelta(data.content);
      } else if (event === 'done') {
        result = data.data;
      } else if (event === 'error') {
        streamError = data;
      }
    });

    const task = wx.request({
      url: `${API_BASE_URL}/api/exam/help_check`,
      method: 'POST',
      enableChunked: true,
      responseType: 'arraybuffer',
      header: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        image: imageUrl,
      },
      success({ statusCode, data }) {
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`HTTP ${statusCode}`));
        } else if (streamError) {
          reject(streamError);
        } else if (result) {
          resolve(result);
        } else {
          reject(new Error('流结束但没有收到 done 事件'));
        }
      },
      fail(error) {
        reject({
          statusCode: 0,
          message: error.errMsg || '网络异常，请稍后重试',
        });
      },
    });

    task.onChunkReceived(({ data }) => {
      feed(decoder.decode(new Uint8Array(data), { stream: true }));
    });
  });
}
```

如果只有本地图片路径，可以用 `FileSystemManager.readFile()` 以 `base64` 读取后提交
`data:image/jpeg;base64,...`。这种方式会增加约三分之一请求体积，更推荐先上传到 OSS 再传 URL。

`image` 支持以下格式：

- 公网可访问的 `http/https` 图片 URL；
- 完整 Data URL，例如 `data:image/jpeg;base64,...`；
- 不带前缀的 Base64，此时服务端按 JPEG 处理，存在格式判断错误的风险。

`imageBase64`、`image_url` 也是兼容字段。可以理解 `wx.chooseMedia` 返回的临时路径是本机路径，不能直接作为 JSON 中的 URL 提交。

## 4. SSE 返回结构

响应按 SSE 分块返回：

```text
event: delta
data: {"content":"{\"subject\":\"数学\","}

event: delta
data: {"content":"\"questions\":[]}"}

event: done
data: {"data":{"subject":"数学","questions":[]}}
```

| 事件    | data 结构                  | 说明                               |
| ------- | -------------------------- | ---------------------------------- |
| `delta` | `{ "content": string }`    | 模型输出的 JSON 文本片段           |
| `done`  | `{ "data": ExamCheckResult }` | 完整解析并校验后的批改结果      |
| `error` | `{ status, message, code? }` | 建流后的模型或解析错误           |

`done.data` 示例：

```json
{
  "data": {
    "subject": "数学",
    "questions": [
      {
        "id": "1",
        "type": "fill_blank",
        "questionText": "计算下列各题",
        "studentAnswer": "2，6",
        "correct": false,
        "correctAnswer": "2，5",
        "coordinate": {
          "x1": 0.05,
          "y1": 0.1,
          "x2": 0.95,
          "y2": 0.4
        },
        "subQuestions": [
          {
            "id": "1.1",
            "questionText": "1 + 1 =",
            "studentAnswer": "2",
            "correct": true,
            "correctAnswer": null,
            "coordinate": {
              "x1": 0.05,
              "y1": 0.12,
              "x2": 0.9,
              "y2": 0.2
            }
          }
        ]
      }
    ]
  }
}
```

| 字段             | 类型              | 说明                                                  |
| ---------------- | ----------------- | ----------------------------------------------------- |
| `subject`        | string            | `数学`、`英语`、`语文`、`历史`、`地理` 之一           |
| `questions`      | array             | 题目列表                                              |
| `id`             | string            | 题目编号，如 `1`、`1.1`                               |
| `type`           | string            | `choice`、`fill_blank`、`short_answer`、`other`       |
| `questionText`   | string            | 识别出的题目文字                                      |
| `studentAnswer`  | string            | 识别出的学生作答，没有时为空字符串                    |
| `correct`        | boolean           | 是否正确                                              |
| `correctAnswer`  | string / null     | 正确答案；答对时为 `null`                             |
| `coordinate`     | object            | 题目区域，使用相对原图的归一化坐标                    |
| `subQuestions`   | array             | 小题列表；普通题为空数组                              |

小题只有 `id`、`questionText`、`studentAnswer`、`correct`、`correctAnswer`、`coordinate`，没有 `type` 和 `subQuestions`。

填空题通常按“大题 → 小题”返回：大题坐标覆盖整道题，小题坐标按作答位置排列。展示批改标记时应优先使用小题坐标；没有小题时使用大题坐标。

`correct=false` 既可能表示答案错误，也可能表示图片中该区域无法识别。无法识别时，`correctAnswer` 通常是“无法识别，请重新拍摄”，可以直接展示，不需要前端另行判断。

接口不返回批改记录 ID，也不提供历史查询。若要保存历史，需要由小程序业务侧存储本次图片和自己生成的业务 ID。

## 5. 坐标映射和结果展示

`coordinate` 是相对原图的归一化坐标，原点在左上角，`x` 向右递增，`y` 向下递增，取值应为 `0~1`。

建议原图使用 `mode="widthFix"` 完整展示，不裁剪、不旋转，再通过百分比定位批改框：

```xml
<view class="homework-canvas" wx:if="{{imagePath}}">
  <image class="homework-image" src="{{imagePath}}" mode="widthFix" />
  <view
    wx:for="{{markers}}"
    wx:key="id"
    class="marker {{item.correct ? 'marker-correct' : 'marker-wrong'}}"
    style="left: {{item.left}}%; top: {{item.top}}%; width: {{item.width}}%; height: {{item.height}}%;"
  ></view>
</view>
```

```css
.homework-canvas {
  position: relative;
  width: 100%;
}

.homework-image {
  display: block;
  width: 100%;
}

.marker {
  position: absolute;
  box-sizing: border-box;
  border: 3rpx solid;
  border-radius: 8rpx;
  pointer-events: none;
}

.marker-correct {
  border-color: #18a058;
  background: rgba(24, 160, 88, 0.08);
}

.marker-wrong {
  border-color: #d03050;
  background: rgba(208, 48, 80, 0.08);
}
```

```js
function clampCoordinate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function buildMarkers(result) {
  return result.questions.reduce((markers, question) => {
    const items =
      question.subQuestions && question.subQuestions.length
        ? question.subQuestions
        : [question];

    items.forEach((item) => {
      const x1 = clampCoordinate(item.coordinate && item.coordinate.x1);
      const y1 = clampCoordinate(item.coordinate && item.coordinate.y1);
      const x2 = clampCoordinate(item.coordinate && item.coordinate.x2);
      const y2 = clampCoordinate(item.coordinate && item.coordinate.y2);
      markers.push({
        id: item.id,
        correct: item.correct === true,
        left: Math.min(x1, x2) * 100,
        top: Math.min(y1, y2) * 100,
        width: Math.abs(x2 - x1) * 100,
        height: Math.abs(y2 - y1) * 100,
      });
    });
    return markers;
  }, []);
}
```

模型给出的坐标用于辅助定位，可能有少量偏差。前端仍需校验空坐标、越界值，并对没有坐标的结果降级为普通列表展示。

## 6. 错误处理

建流前发生的错误仍使用 HTTP 错误状态和 JSON：

```json
{
  "status": 400,
  "message": "请上传作业图片"
}
```

| HTTP 状态 | 常见场景                                           | 小程序处理建议                        |
| --------- | -------------------------------------------------- | ------------------------------------- |
| `400`     | 未上传图片、文件类型或图片格式错误                 | 提示重新选择或拍摄                      |
| `413`     | multipart 请求体超过上传限制（约 10MB）            | 压缩或重新拍摄图片后重试                |
| `401`     | 未登录、token 非法或过期                           | 重新调用登录接口，成功后重试一次        |
| `403`     | 会员校验开启且当前会员已过期                       | 展示续费入口，不要自动重试              |
| `429`     | 当日作业检查次数已用完                             | 提示明天再试，不要自动重试              |
| `502`     | 模型调用失败或模型返回内容无法解析                 | 提示“批改服务暂时不可用”，允许用户重试  |
| `503`     | 服务端未配置模型或登录密钥                         | 提示服务暂不可用，联系后端排查          |
| `500`     | 其他服务端异常                                     | 展示通用错误，允许用户稍后重试          |

流建立后，HTTP 状态通常已经是 `200`。模型调用或结果解析失败时，应继续监听
`event: error`，并以其中的 `status`、`message`、`code` 为准，不能只看 HTTP 状态。
建流前的普通 JSON 错误不会返回内部错误码，具体原因需要查看服务端日志。

## 7. 小程序接入注意事项

- 只提交一张完整作业图片；多页作业逐页调用。
- 上传前可压缩图片，但要确保文字清晰可辨。
- 不要在小程序端保存或使用 `QWEN_APP_KEY`，模型密钥只存在服务端环境变量中。
- 等待模型结果期间保持页面状态，避免用户重复点击；请求失败后由用户主动重试。
- 接口不识别物理、化学、生物等其他科目，只会返回约定的五个科目之一。
- 生产环境的请求域名需要加入小程序后台的 `request` 合法域名。
