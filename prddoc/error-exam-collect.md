
# 题目检测-阿里云

> 2025-03-31

## 一、接口描述

### 1. 功能描述

天壤题目检测，支持检测图片上的题目，并根据批改信息区分出是否为错题。

### 2. 接口数据要求

- **图片格式**: base64编码
- **图片类型**: jpg/jpeg/png
- **图片大小**: 小于5M
- **QPS**: 3

> 若图片过大，建议使用jpg压缩率较大的格式

## 二、请求说明

### 1. 接口地址

详情见商品详情页

### 2. 请求方式

`POST`

### 3. 请求参数说明

#### （1）Header

| 名称          | 类型   | 必填  | 示例值           | 描述                                           |
| ------------- | ------ | ----- | ---------------- | ---------------------------------------------- |
| Content-Type  | String | false | application/json | json格式                                       |
| Authorization | String | true  | xxxxxxxxxxx      | 阿里云上的APPCODE，如 `'APPCODE xxxxxxxxxx'` |

#### （2）Body

| 参数名   | 参数类型 | 是否必须 | 值示例       | 备注                                                                                                         |
| -------- | -------- | -------- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| media_id | string   | true     | 图片base64值 | `{"media_id":"图片base64值"}`如果调用时报错，可以试试把下面base64图片的前缀去掉：`data:image/png;base64` |

## 三、返回说明

### 1. 返回参数

| 名称      | 类型   | 示例值                           | 描述     |
| --------- | ------ | -------------------------------- | -------- |
| code      | int    | 0                                | 状态code |
| message   | string | success                          | 返回信息 |
| data      | object | {...}                            | data     |
| requestId | string | 08a62fc6a82ff6e98c70f2954b4088f7 | 请求id   |

#### 1.1 data字段说明

| 名称    | 类型   | 示例值  | 说明     |
| ------- | ------ | ------- | -------- |
| code    | int    | 0       | 状态code |
| message | string | success | 返回信息 |
| data    | object | {...}   | data     |

##### 1.1.1 第二层data字段说明

| 名称               | 类型  | 示例值 | 说明         |
| ------------------ | ----- | ------ | ------------ |
| elapsed_time       | float | 0.1463 | 服务处理耗时 |
| model_elapsed_time | float | 0.1362 | 模型推理耗时 |
| height             | int   | 1440   | 图片高度     |
| width              | int   | 1080   | 图片宽度     |
| structure_result   | array | [...]  | 处理结果     |

###### 1.1.1.1 structure_result元素字段说明

| 名称       | 类型       | 示例值         | 说明                                                       |
| ---------- | ---------- | -------------- | ---------------------------------------------------------- |
| block_type | string     | wrong_question | 题目类型：wrong_question/question                          |
| location   | array[int] | [171,979,...]  | 题目区域，共8个值，每两个表示一个点，共4个点，顺序是顺时针 |

### 2. code字段对应表

| 错误号（code） | 错误信息（message）    | 描述               |
| -------------- | ---------------------- | ------------------ |
| 0              | success                | 成功               |
| 1000           | body error             | 请求主体错误       |
| 1001           | param error            | 请求参数错误       |
| 1002           | content type error     | Content-Type错误   |
| 1003           | image not exist        | 没有找到图片文件   |
| 1004           | image size error       | 图片大小错误       |
| 1005           | image format error     | 图片类型错误       |
| 1006           | invalid signature      | 无效的签名         |
| 1007           | body size error        | body大小错误       |
| 1008           | no authorization       | 没有认证权限       |
| 2000           | server unknown error   | 服务端未知错误     |
| 2001           | server timeout         | 服务端超时         |
| 2003           | no content recognition | 没有识别出内容     |
| 2004           | validate data error    | 校验识别数据错误   |
| 3000           | remote server error    | 服务端远程服务错误 |
| 4000           | base server error      | 基础服务错误       |

### 3. 返回示例

```json
{
  "code": 0, // AI状态码
  "message": "success", // AI信息
  "data": { // AI数据
    "elapsed_time": 0.08928799629211426, // AI响应时间
    "model_elapsed_time": 0.08855795860290527, // 模型响应时间
    "height": 1280, // 图片高度
    "width": 961, // 图片宽度
    "structure_result": [ // 识别结果
      {
        // 分别是：wrong_question,question
        "block_type": "wrong_question",
        "location": [ // 识别位置，四个顶点坐标，分别是x1,y1,x2,y2,x3,y3,x4,y4
          180,
          847,
          813,
          847,
          813,
          926,
          180,
          926
        ]
      },
      {
        "block_type": "question",
        "location": [
          201,
          1041,
          701,
          1041,
          701,
          1075,
          201,
          1075
        ]
      }
    ]
  }
}
```
