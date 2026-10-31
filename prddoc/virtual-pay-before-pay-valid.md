# 小程序虚拟支付 before_pay_valid

## 接口

```http
POST /api/virtual-pay/before_pay_valid
Authorization: Bearer <token>
```

```json
{
  "code": "wx.login 返回的 code",
  "env": 1,
  "productId": "vip_1",
  "price": 10
}
```

服务端通过 bearer token 获取当前 openid，再使用 `code` 调用 `jscode2session`。
只有两者完全一致时才生成支付签名；请求体中的 openid/userId 不会被信任。

响应：

```json
{
  "status": 200,
  "data": {
    "signData": "{\"offerId\":\"1450699648\",\"buyQuantity\":1,\"env\":1,\"currencyType\":\"CNY\",\"productId\":\"vip_1\",\"goodsPrice\":10,\"outTradeNo\":\"VP...\",\"attach\":\"pay-test\"}",
    "paySig": "hex-hmac-sha256",
    "signature": "hex-hmac-sha256",
    "mode": "short_series_goods"
  }
}
```

前端必须原样使用返回的 `signData`，不能重新序列化。`productId` 和 `price`
由请求传入，`price` 必须是正整数分并写入 `signData.goodsPrice`；数量固定为 1，
`env` 必须由客户端传入，`0` 使用现网环境，`1` 使用沙箱环境。

输入校验：

- `code` 必须是非空字符串，首尾不能有空白，最长 512 字符。
- `productId` 必须是 1-64 位字母、数字、`_` 或 `-`。
- `price` 必须是 JSON 数字，不能是字符串或浮点数，必须是正整数分。
- `env` 必须传入，且只能是整数 `0` 或 `1`。

## 环境配置

服务端不再通过配置判断沙箱环境。客户端传入 `env=1` 时使用
`WX_VIRTUAL_PAY_SANDBOX_APP_KEY`，传入 `env=0` 时使用
`WX_VIRTUAL_PAY_PRODUCTION_APP_KEY`。

```dotenv
WX_VIRTUAL_PAY_OFFER_ID=1450699648
WX_VIRTUAL_PAY_SANDBOX_APP_KEY=
WX_VIRTUAL_PAY_PRODUCTION_APP_KEY=
```

签名算法：

```text
paySig = hex(hmac_sha256(appKey, "requestVirtualPayment&" + signData))
signature = hex(hmac_sha256(sessionKey, signData))
```

## 注意

- `wx.requestVirtualPayment` 成功不代表已发货，不能据此开通权益。
- 发货应由 `xpay_goods_deliver_notify` 或 `xpay/query_order` 确认后完成。
- 沙箱仅适用于 Android、鸿蒙、Windows；iOS 不支持沙箱。
- iOS 实付最低 1 元，因此 `vip_1` 的 0.1 元价格不能在 iOS 完成支付。
