# 题目检测 / 错题收集接口对接文档（/api/file/error_collect）

## 1. 接口概述

该接口用于检测试卷图片中的所有题目，并返回题目区域坐标及批改类型。服务端调用阿里云市场的天壤智能试卷题目检测接口，根据返回的 `block_type` 区分普通题目和错题。

| 项 | 说明 |
| --- | --- |
| 请求方式 | `POST` |
| 请求路径 | `/api/file/error_collect` |
| Content-Type | `application/json` |
| 鉴权 | 必须携带请求头 `x-user-id`（用户 openid） |
| 响应格式 | `application/json; charset=utf-8` |
| 返回内容 | 图片尺寸、题目区域坐标和题目类型 |

> 控制器使用 `@Api('/file')` 装饰，实际对外路径为 `/api/file/error_collect`。
> 对应源码：`src/controller/file.ts`、`src/service/ErrorCollectService.ts`。

## 2. 请求参数

### 2.1 请求头

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | 固定 `application/json` |
| `x-user-id` | 是 | 用户 openid；缺失时报 `userId is required` |

### 2.2 请求体

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `media_id` | string | 是 | 单张试卷图片的 base64 |
| `lane` | string | 否 | 业务线，默认 `whale`，一般无需传递 |

图片要求：

- 支持 `jpg`、`jpeg`、`png`。
- 解码后的图片大小不得超过 5MB。
- 支持纯 base64，也支持 `data:image/png;base64,...` 或
  `data:image/jpeg;base64,...` 形式的 data URL。服务端会自动去掉前缀。
- 一次只检测一张图片。

校验失败信息：

| 场景 | message |
| --- | --- |
| 未登录 / 未带 `x-user-id` | `userId is required` |
| `media_id` 缺失 | `media_id is required` |
| `media_id` 不是有效 base64 | `media_id is not valid base64` |
| 图片超过 5MB | `media_id image size must be less than 5MB` |
| 图片不是 jpg/jpeg/png | `media_id image format must be jpg, jpeg or png` |
| 用户不存在 | `user_not_existed` |
| 次数已用完 | `count_error_collect_limit_is_used_up` |

## 3. 请求示例

### 3.1 curl

```bash
curl -X POST 'http://localhost:7001/api/file/error_collect' \
  -H 'Content-Type: application/json' \
  -H 'x-user-id: <用户openid>' \
  -d '{
    "media_id": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..."
  }'
```

### 3.2 前端调用（fetch）

```js
/**
 * @param {string} mediaId 图片 base64，可带 data URL 前缀
 * @returns {Promise<object>} 题目检测结果
 */
async function collectWrongQuestions(mediaId) {
  const res = await fetch('/api/file/error_collect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': getUserId(),
    },
    body: JSON.stringify({ media_id: mediaId }),
  });
  const json = await res.json();
  if (!res.ok || json.status !== 200) {
    throw new Error(json.message || '题目检测失败');
  }
  return json;
}
```

从文件生成 base64：

```js
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const mediaId = await fileToBase64(fileInput.files[0]);
const result = await collectWrongQuestions(mediaId);
```

## 4. 响应说明

### 4.1 成功响应

```json
{
  "status": 200,
  "code": 0,
  "message": "success",
  "data": {
    "elapsed_time": 0.08928799629211426,
    "model_elapsed_time": 0.08855795860290527,
    "height": 1280,
    "width": 961,
    "structure_result": [
      {
        "block_type": "wrong_question",
        "location": [180, 847, 813, 847, 813, 926, 180, 926]
      },
      {
        "block_type": "question",
        "location": [201, 1041, 701, 1041, 701, 1075, 201, 1075]
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | number | 后端包装状态，成功为 `200` |
| `code` | number | 题目检测状态，成功为 `0` |
| `message` | string | 状态说明 |
| `data.width` | number | 图片宽度 |
| `data.height` | number | 图片高度 |
| `data.structure_result` | array | 题目区域列表 |
| `data.structure_result[].block_type` | string | `wrong_question` 表示错题，`question` 表示普通题目 |
| `data.structure_result[].location` | number[] | 8 个坐标值，每两个值为一个顶点，共 4 个点，按顺时针排列 |

前端可根据 `location` 在图片上绘制题目框：

```js
for (const item of result.data.structure_result) {
  const [x1, y1, x2, y2, x3, y3, x4, y4] = item.location;
  // 使用 x1/y1、x2/y2、x3/y3、x4/y4 绘制旋转矩形
}
```

### 4.2 异常响应

业务错误由全局中间件包装为 HTTP 500：

```json
{
  "status": 404,
  "message": "没有识别出题目内容"
}
```

常见上游状态：

| code | 默认文案 |
| --- | --- |
| `1001` | 请求参数错误 |
| `1003` | 没有找到图片文件 |
| `1004` | 图片大小错误，图片需小于 5MB |
| `1005` | 图片格式错误，仅支持 jpg、jpeg、png |
| `1008` | 无调用权限，请检查 AppCode 或商品开通状态 |
| `2001` | 题目检测服务超时 |
| `2003` | 没有识别出题目内容 |
| `3000` | 题目检测远程服务错误 |
| `4000` | 题目检测基础服务错误 |

调用方应同时判断 HTTP `res.ok` 和响应体 `status === 200`。

## 5. 鉴权与次数限制

- 通过 `x-user-id` 识别用户；接口会校验用户是否存在。
- 使用独立次数类型 `count_error_collect_limit`，新用户默认 10 次。
- 请求进入时由 `ErrorCollectLimitMiddleware` 预检查额度，成功后扣减 1 次。
- 当服务端 `limitCheck = false` 时不预检查、不扣减；本仓库 local 配置默认关闭次数校验。
- `AppKey`、`AppSecret`、`AppCode` 配置在 `src/config/config.local.ts` 的 `errorCollect` 节点中。请求阿里云网关时使用 `AppCode`，不会把 `AppSecret` 返回给前端。

## 6. 注意事项

1. 图片 base64 会使请求体增大约 1/3，建议上传前压缩图片，并确保原图不超过 5MB。
2. 上游接口 QPS 为 3，前端不要并发批量提交大图。
3. `location` 是顺时针四点坐标，不一定是水平/竖直矩形；预览时应按四边形绘制。
4. 服务端超时为 30 秒，建议前端请求超时设置为 35 秒以上。
5. 错误时不会扣减用户次数；只有上游检测成功后才扣减。
