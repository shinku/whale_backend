# 微信小程序消息推送

官方文档：
<https://developers.weixin.qq.com/miniprogram/dev/framework/server-ability/message-push.html>

## 接口

```text
GET  /api/wx_message
POST /api/wx_message
```

小程序后台消息推送配置：

- URL：`https://api.whalepea.com/api/wx_message`
- Token：`whalepea_wx_message`
- EncodingAESKey：`AJK7hBbpoHjMuLiiFPCkgrmnWEo3O50NaoB6oiQbCqf`
- 消息加解密方式：安全模式
- 数据格式：JSON

## URL 验证

微信发送 GET 请求并携带 `signature`、`timestamp`、`nonce`、`echostr`。
服务端将 Token、timestamp、nonce 字典序排序，拼接后计算 SHA1，验签通过后原样返回
`echostr`。

## 消息接收

安全模式下微信发送：

```json
{
  "ToUserName": "gh_xxx",
  "Encrypt": "base64-ciphertext"
}
```

URL 查询参数包含 `timestamp`、`nonce`、`encrypt_type=aes` 和 `msg_signature`。
服务端按 `Token、timestamp、nonce、Encrypt` 字典序 SHA1 验签，然后使用
`EncodingAESKey` 执行 AES-256-CBC/PKCS#7 解密，提取 JSON，并验证消息尾部 AppID。

明文模式也会校验普通 `signature`，但生产环境应使用安全模式。

验签、解密和 AppID 校验通过后返回纯文本 `success`。消息内容不会写入日志。
解密后的完整消息以 UTF-8 文本写入
`wechat_message_push_record.content`，并记录事件、用户和订单等可检索字段。

## 事件处理

事件分发集中在 `src/service/eventHandler/WechatEventHandle.ts`。每个事件对应一个
独立处理函数，未知事件仍会落库并标记为 `IGNORED`。

当前已实现：

- `xpay_goods_deliver_notify`：解析 `OpenId`、`OutTradeNo`、`Env`、
  `WeChatPayInfo` 和 `GoodsInfo`，其中 `ProductId`、`Quantity`、`OpenId` 会组成
  `VipPurchaseEvent`，更新用户 VIP 记录，并生成对应的 `vip_order` 和
  `vip_transaction`。

道具映射：

| ProductId  | 会员类型         |   时长 |    标价 |
| ---------- | ---------------- | -----: | ------: |
| `vip_9_9`  | 月卡 `monthly`   |  30 天 |  9.9 元 |
| `vip_28_8` | 季卡 `quarterly` |  90 天 | 28.8 元 |
| `vip_68`   | 年卡 `yearly`    | 365 天 | 67.8 元 |

`Quantity` 会乘以套餐时长。有效会员从当前到期时间继续延长，失效会员从支付时间
开始计算。`OutTradeNo` 优先读取事件顶层字段，也兼容
`GoodsInfo.OutTradeNo`，并作为本地 `vip_order.order_no`；重复推送不会重复发放。

## 配置

```dotenv
WX_MESSAGE_PUSH_TOKEN=
WX_MESSAGE_PUSH_ENCODING_AES_KEY=
```

`EncodingAESKey` 必须是微信后台生成的 43 字符密钥。小程序 AppID 复用
`weixinMiniProgram.appid`。

## 推送记录表

`wechat_message_push_record` 主要字段：

| 字段            | 类型         | 说明                                   |
| --------------- | ------------ | -------------------------------------- |
| `event_name`    | VARCHAR(64)  | 微信事件类型                           |
| `openid`        | VARCHAR(64)  | 用户 openid                            |
| `out_trade_no`  | VARCHAR(64)  | 业务订单号                             |
| `env`           | TINYINT      | 0 现网，1 沙箱                         |
| `product_id`    | VARCHAR(64)  | 道具 ID                                |
| `quantity`      | INT UNSIGNED | 购买数量                               |
| `content`       | TEXT         | 解密后的完整推送内容                   |
| `status`        | VARCHAR(20)  | RECEIVED、PROCESSED、IGNORED 或 FAILED |
| `error_message` | TEXT         | 事件处理失败原因                       |

## 发货说明

该接口负责微信消息推送协议层的验签、解密和接收。`xpay_goods_deliver_notify`
事件不能直接作为发货依据；后续仍需按虚拟支付文档校验订单信息并幂等发放权益。
