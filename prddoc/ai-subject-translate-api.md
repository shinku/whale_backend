# AI 图片翻译接口

图片翻译接口会识别图片中的文字行，翻译为简体中文，并返回每行文字的位置、颜色和字体大小。原图会上传到 OSS，生成结果按 UUID 保存 24 小时。

| 项目     | 内容                                  |
| -------- | ------------------------------------- |
| 创建接口 | `POST /api/ai/subject/translate`      |
| 查询接口 | `GET /api/ai/subject/translate/{id}`  |
| 请求格式 | `application/json`                    |
| 图片格式 | Data URL 或裸 Base64，解码后最大 10MB |
| 鉴权     | 创建接口沿用 `VipCheckMiddleware`     |
| 保存时长 | 24 小时                               |

## 请求

```http
POST /api/ai/subject/translate
Content-Type: application/json
x-user-id: <openid>
```

请求体：

```json
{
  "source": "data:image/png;base64,iVBORw0KGgo...",
  "direction": "en_to_zh"
}
```

| 字段        | 要求                                                  |
| ----------- | ----------------------------------------------------- |
| `source`    | 单张图片的 Data URL 或裸 Base64，解码后最大 10MB      |
| `direction` | `en_to_zh`（默认）或 `zh_to_pinyin`，控制图片转换方向 |

兼容旧字段 `imageBase64` 和 `image`。

| direction 值   | 说明                                                     |
| -------------- | -------------------------------------------------------- |
| `en_to_zh`     | 英译中，默认值；只处理英文源内容，中文内容不翻译、不返回 |
| `zh_to_pinyin` | 中译音；只处理中文源内容，非中文内容不转写、不返回       |

接口不接受文件上传或公网图片 URL，只接受 Base64 图片。接口也会被
`VipCheckMiddleware` 校验；VIP 校验开启时，需要有效的会员身份。

请求中的 `source` 是原始 Base64，仅用于本次识别和 OSS 上传，不会原样写入数据库。

## 响应

```json
{
  "status": 200,
  "data": {
    "source": "pub/ai-translate/translate_xxx.png",
    "result": [
      {
        "message": "这是一段翻译",
        "rect": {
          "x": 10,
          "y": 10,
          "w": 200,
          "h": 20
        },
        "color": "#333333",
        "background": "#ffffff",
        "fontSize": 16
      }
    ],
    "direction": "en_to_zh",
    "imageWidth": 1920,
    "imageHeight": 1080
  },
  "id": "b4f0ea74-..."
}
```

| 字段          | 说明                                          |
| ------------- | --------------------------------------------- |
| `message`     | 翻译结果或拼音结果                            |
| `rect`        | 原图像素坐标，左上角为 `(x, y)`，`w/h` 为宽高 |
| `color`       | 原文主要颜色，统一为 `#RRGGBB`                |
| `background`  | 原文行背景主色，统一为 `#RRGGBB`              |
| `fontSize`    | 原文字体大小的近似像素值，正整数              |
| `direction`   | 本次转换方向                                  |
| `imageWidth`  | 原图实际宽度（像素）                          |
| `imageHeight` | 原图实际高度（像素）                          |

服务端会按图片中的文字段落逐段返回，坐标用于前端直接覆盖绘制翻译结果。无法识别的段落会被省略；无效坐标会被过滤，无效颜色回退为 `#333333`。
无效背景色回退为 `#ffffff`。

结果以视觉行为单位：每个 `message` 都不包含换行符，可直接在 canvas 的单行中绘制。
如果模型仍返回包含换行符的文本，服务端会拆成多个结果，并把原 `rect` 的纵向范围
按行均分到对应的 `rect.y/rect.h`。

`source` 是原图上传到 OSS 后的相对路径，`result` 是翻译结果。接口会把
`{ source, result, direction, imageWidth, imageHeight }` 写入
`ai_subject_store`，有效期 24 小时，并返回 UUID
格式的 `id`。数据库不保存图片 Base64。

响应外层统一为：

```json
{
  "status": 200,
  "data": {
    "source": "pub/ai-translate/translate_xxx.png",
    "result": [],
    "direction": "en_to_zh",
    "imageWidth": 1920,
    "imageHeight": 1080
  },
  "id": "UUID"
}
```

注意请求和响应都使用 `source` 字段，但请求中是 Base64，响应中是 OSS 相对路径。
前端使用自己的文件域名拼接，例如：

```ts
const imageUrl = `https://fms.whalepea.com/${source.replace(/^\/+/, '')}`;
```

## 按 id 获取结果

```http
GET /api/ai/subject/translate/{id}
```

```json
{
  "status": 200,
  "data": {
    "source": "pub/ai-translate/translate_xxx.png",
    "result": [],
    "direction": "en_to_zh",
    "imageWidth": 1920,
    "imageHeight": 1080
  },
  "id": "b4f0ea74-..."
}
```

结果不存在返回 `404`，超过 24 小时返回 `410`。

## 错误

| HTTP 状态 | code                                | 说明                   |
| --------- | ----------------------------------- | ---------------------- |
| `400`     | `TRANSLATE_IMAGE_REQUIRED`          | 未提供图片             |
| `400`     | `INVALID_TRANSLATE_IMAGE`           | Base64 或图片格式无效  |
| `400`     | `INVALID_TRANSLATION_DIRECTION`     | 转换方向不在支持范围   |
| `401`     | `AUTH_REQUIRED`                     | VIP 校验开启且未登录   |
| `403`     | `VIP_REQUIRED`                      | VIP 校验开启且会员无效 |
| `404`     | `TRANSLATION_NOT_FOUND`             | 查询的翻译结果不存在   |
| `410`     | `TRANSLATION_EXPIRED`               | 翻译结果超过 24 小时   |
| `413`     | `TRANSLATE_IMAGE_TOO_LARGE`         | 图片解码后超过 10MB    |
| `502`     | `QWEN_REQUEST_FAILED`               | Qwen 调用失败          |
| `502`     | `QWEN_INVALID_TRANSLATION_RESPONSE` | Qwen 返回内容无法解析  |
| `502`     | `TRANSLATE_IMAGE_UPLOAD_FAILED`     | OSS 上传失败           |
| `500`     | `INVALID_TRANSLATION_STORE`         | 已存储结果损坏         |

## 绘制说明

- `rect` 使用原图像素坐标，不是归一化比例。
- `imageWidth/imageHeight` 是原图实际像素尺寸，前端可用于计算响应式缩放和偏移。
- `message` 不包含换行符，可在 canvas 上按单行绘制。
- `fontSize` 单位也是原图像素。
- `background` 可用于在绘制翻译文字前覆盖原文字区域。
- `en_to_zh` 不返回图片中的中文源内容；`zh_to_pinyin` 不返回英文或数字源内容。
- 如果模型返回多行文本，服务端会拆分，并均分原 `rect` 的纵向区域。
- 前端可用 `color` 作为翻译文字颜色，也可结合背景亮度选择描边或遮罩。
