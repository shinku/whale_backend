# 微信支付证书目录

该目录只保存部署时只读挂载的证书，所有证书和私钥均已通过 `.gitignore`
排除，不能提交到仓库、打进小程序包或粘贴到聊天/日志中。

需要放置：

- `apiclient_key.pem`：商户 API 私钥，对应 `WX_PAY_PRIVATE_KEY_PATH`
- `platform_cert.pem`：微信支付平台证书，对应 `WX_PAY_PLATFORM_CERT_PATH`

可选的环境变量：

- `WX_PAY_MCH_SERIAL_NO`：商户 API 证书序列号
- `WX_PAY_PLATFORM_SERIAL_NO`：平台证书序列号；配置后会额外校验回调请求头
- `WX_PAY_API_V3_KEY`：32 字节 API v3 密钥
- `WX_PAY_NOTIFY_URL`：公网 HTTPS 回调地址
- `WX_PAY_REFUND_NOTIFY_URL`：公网 HTTPS 退款回调地址

生产环境优先使用密钥管理服务或只读挂载提供证书，不要将真实值写入
`.env.example`。修改证书后需重启后端进程才能重新读取。
