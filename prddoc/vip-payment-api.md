# 鲸鱼会员与微信支付 API

本文档描述后端已实现的会员购买链路。价格、有效期和会员类型均以后端
`vip_plan` 表为准，客户端传入的金额会被忽略。

## 1. 会员套餐

服务首次读取套餐或首次下单时会幂等写入默认配置，不会覆盖后台已经修改过的行。

| 套餐 ID | 名称 | 会员类型 | 有效天数 | 售价 |
| --- | --- | --- | ---: | ---: |
| `month` | 月卡会员 | `monthly` | 30 | 990 分（9.9 元） |
| `quarter` | 季卡会员 | `quarterly` | 90 | 2880 分（28.8 元） |
| `year` | 年卡会员 | `yearly` | 365 | 6800 分（68 元） |

`user_vip_record.type` 的新值为 `guest | monthly | quarterly | yearly`。
历史数据中的 `vip` 和 `svip` 仍可读取并参与有效期判断，下单成功后类型会更新为
对应套餐的新类型。

## 2. 登录

支付接口不再信任 `x-user-id`，必须使用服务端签发的 bearer token。

### `POST /api/auth/wechat-login`

请求：

```json
{
  "code": "wx.login 返回的 code"
}
```

响应核心字段：

```json
{
  "status": 200,
  "data": {
    "accessToken": "signed-token",
    "tokenType": "Bearer",
    "expiresIn": 7200,
    "user": {
      "openid": "openid",
      "type": "guest",
      "active": false,
      "available_start": "2026-10-25T00:00:00.000Z",
      "available_end": "2026-11-01T00:00:00.000Z",
      "vipList": []
    }
  }
}
```

后续请求：

```http
Authorization: Bearer <accessToken>
```

token 使用 `AUTH_TOKEN_SECRET` 做 HMAC-SHA256 签名并带过期时间。生产环境如果未配置
至少 16 字符的密钥，鉴权接口会返回 503。

## 3. 会员接口

以下接口均要求 bearer token 和支付专用限流中间件。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/vip/plans` | 按 `sort` 返回当前可售套餐 |
| `GET` | `/api/vip/info` | 返回当前登录用户所有仍在有效期内的会员记录数组 |
| `POST` | `/api/vip/orders` | 使用服务端套餐价格创建微信 JSAPI 订单 |
| `GET` | `/api/vip/orders/{orderNo}` | 查询当前登录用户自己的订单 |

### 获取会员信息

`GET /api/vip/info` 的 `data` 为当前有效会员记录数组，按购买时间倒序排列。
已过期和已退款的记录不会返回：

```json
{
  "status": 200,
  "data": [
    {
      "type": "monthly",
      "name": "月卡会员",
      "active": true,
      "available_start": "2026-12-30T00:00:00.000Z",
      "available_end": "2027-01-29T00:00:00.000Z"
    },
    {
      "type": "quarterly",
      "name": "季卡会员",
      "active": true,
      "available_start": "2026-10-01T00:00:00.000Z",
      "available_end": "2026-12-30T00:00:00.000Z"
    }
  ]
}
```

兼容接口 `GET /api/user/:token` 也新增 `vip` 数组，内容与上述会员记录一致；
原有 `type`、`available_start`、`available_end` 汇总字段继续保留。

### 创建订单

```json
{
  "planId": "quarter",
  "quantity": 1
}
```

`quantity` 本期只能为 1。请求体里的 `amountCents`、`openid`、`userId` 等字段均被忽略。
同一用户、同一套餐在 10 秒内重复请求且已有可用 `prepay_id` 时，会返回同一订单。

响应：

```json
{
  "status": 200,
  "data": {
    "orderNo": "VIP20261025120000123456",
    "status": "pending",
    "amountCents": 2880,
    "payment": {
      "timeStamp": "1792900800",
      "nonceStr": "nonce",
      "package": "prepay_id=wx123",
      "signType": "RSA",
      "paySign": "base64-signature"
    }
  }
}
```

`payment` 可直接传给 `wx.requestPayment`。`wx.requestPayment` 的成功回调不代表权益已到账，
前端应继续轮询订单接口。

### 查询订单

```json
{
  "status": 200,
  "data": {
    "orderNo": "VIP20261025120000123456",
    "status": "paid",
    "amountCents": 2880
  }
}
```

状态值：`pending | paid | closed | failed | refunded`。

订单创建超过 3 秒且仍为 `PENDING` 时，查询接口会主动向微信查单；微信确认成功后走与
异步回调相同的校验和入账逻辑。

## 4. 微信支付回调

回调地址：

```text
POST /api/pay/wechat/notify/vip
```

处理顺序：

1. 使用 `ctx.request.rawBody` 读取原始请求体。
2. 使用平台证书校验 `Wechatpay-Timestamp`、`Wechatpay-Nonce`、`Wechatpay-Signature`。
3. 拒绝超过 5 分钟的时间戳。
4. 使用 API v3 密钥进行 AES-256-GCM 解密。
5. 校验事件类型、交易状态、AppID、商户号、订单号、openid、金额和币种。
6. 对本地订单加行锁，并把订单、会员有效期和交易记录放在同一事务内更新。
7. 已支付订单重复回调直接成功返回，不再延长会员。

回调成功返回：

```json
{
  "code": "SUCCESS",
  "message": "成功"
}
```

验签、解密或入账失败返回 5xx，使微信继续重试。定时任务每 10 分钟检查一次超过 2 小时
的 `PENDING` 订单，先主动查单，确认未支付后再关闭。

## 4.1 退款

退款由后台管理员发起：

```http
POST /admin/vip/refund/{openid}
```

```json
{
  "orderNo": "VIP20261025120000123456",
  "reason": "用户申请退款"
}
```

`orderNo` 必须是该 openid 最新一笔 `PAID` 订单，且 `membership_end_at` 仍晚于当前时间。
服务端会再次校验，不能通过传入旧订单号绕过限制。退款处理中禁止创建新会员订单。

退款申请：

1. 在 `vip_refund` 创建全额退款明细。
2. 调用微信支付 v3 `/v3/refund/domestic/refunds`。
3. 微信退款回调 `POST /api/pay/wechat/notify/refund` 验签、解密、校验金额和商户号。
4. 退款成功后原订单改为 `REFUNDED`。
5. 从该用户剩余 `PAID` 订单重新计算会员汇总并更新 `user_vip_record`。
6. 如果上一笔季卡仍在有效期内，会员自动回退为季卡及季卡原到期时间。

手工补录订单没有商户支付交易，退款时标记为 `MANUAL`，不会调用微信退款接口。

## 5. 数据表

### `vip_plan`

套餐 ID、会员类型、名称、天数、售价、划线价、角标、推荐标记、可售状态和排序。
金额字段均为整数分。

### `vip_order`

保存 `order_no`、openid、套餐快照、金额、订单状态、`prepay_id`、微信交易号、
支付时间、本次权益起止时间和最近一次脱敏微信错误码。

### `vip_transaction`

每个已支付订单一条交易结果记录，保存微信交易号、交易状态、金额、来源
（`CALLBACK` / `QUERY`）、支付时间和脱敏交易摘要。`order_no` 唯一，作为数据库层幂等约束。

### `vip_refund`

每次退款申请保存一条独立明细，支持部分退款和失败后重新申请。主要字段：

- `out_refund_no`：本系统退款单号，唯一，同时作为微信 `out_refund_no`
- `order_no`、`transaction_id`：关联支付订单和微信支付交易号
- `wx_refund_id`：微信退款成功后返回的退款单号
- `amount_cents`、`total_cents`、`currency`：退款金额和原订单实付金额
- `status`：`CREATING | PROCESSING | SUCCESS | ABNORMAL | CLOSED | FAILED`
- `reason`、`operator_id`：退款原因和后台操作人
- `last_wx_error_code`、`payload_summary`：脱敏错误码和回调摘要
- `requested_at`、`succeeded_at`：申请成功和退款成功时间

### `user_vip_record`

继续保存用户当前 `type`、`available_start`、`available_end`。续费时：

```text
new_start = 当前会员有效 ? 原 available_start : now
new_end   = max(now, 原 available_end) + 套餐快照天数
```

## 6. 证书与配置

将商户私钥和平台证书只读挂载到 `certs/`。真实 PEM 文件不会提交到仓库。

| 环境变量 | 说明 |
| --- | --- |
| `AUTH_TOKEN_SECRET` | 登录 token 签名密钥 |
| `AUTH_TOKEN_TTL_SECONDS` | token 有效期，默认 7200 秒 |
| `WX_APP_ID` | 小程序 AppID |
| `WX_APP_SECRET` | 小程序登录 Secret |
| `WX_PAY_APP_ID` | 微信支付绑定的 AppID |
| `WX_PAY_MCH_ID` | 商户号 |
| `WX_PAY_MCH_SERIAL_NO` | 商户 API 证书序列号 |
| `WX_PAY_PRIVATE_KEY_PATH` | 商户私钥 PEM 路径 |
| `WX_PAY_API_V3_KEY` | 32 字节 API v3 密钥 |
| `WX_PAY_NOTIFY_URL` | 公网 HTTPS 回调地址 |
| `WX_PAY_PLATFORM_CERT_PATH` | 微信支付平台证书 PEM 路径 |
| `WX_PAY_PLATFORM_SERIAL_NO` | 可选，平台证书序列号 |

本地可参考 `.env.example`。应用不会自动加载 `.env`，本地启动前可执行：

```bash
set -a
source .env
set +a
npm run dev
```

生产环境通过 PM2、容器 secret 或密钥管理服务注入变量，不要把真实值写进仓库。
回调地址必须已经在公网 HTTPS 可达，并加入小程序后台配置。

## 7. 验收

上线前至少验证：

- 无 token、伪造 `x-user-id`、查询他人订单均返回 401/404。
- 请求携带错误金额时，订单金额仍来自 `vip_plan`。
- 微信支付成功后回调验签、解密、金额校验通过，会员只延长一次。
- 同一成功回调连续发送 5 次，`available_end` 不变。
- AppID、商户号、金额任一不一致时不发放权益。
- 支付成功但回调延迟时，订单查询可主动查单完成入账。
- 已有会员续费从原到期日累加。
- 2 小时未支付订单先查单，再关闭。
- 使用真实测试商户完成一笔端到端支付，并核对商户平台交易记录。
