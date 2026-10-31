# 额外业务配置

配置路径：

```text
/config/extra_config.json
```

文件不存在、无法解析或字段类型错误时使用默认值：

```json
{
  "vipCheckEnabled": false,
  "guestVipInitialization": true,
  "guestValidityDays": 3
}
```

字段说明：

| 字段                     | 类型             | 默认值  | 说明                                                         |
| ------------------------ | ---------------- | ------- | ------------------------------------------------------------ |
| `vipCheckEnabled`        | boolean          | `false` | `VipCheckMiddleware` 的全局开关；关闭时所有 VIP 校验直接通过 |
| `guestVipInitialization` | boolean          | `true`  | 是否在首次用户访问时创建 guest VIP                           |
| `guestValidityDays`      | positive integer | `3`     | guest VIP 有效天数                                           |

配置由单例 `ExtraConfigService` 读取，并缓存 5 分钟。更新文件后最多等待
5 分钟生效，不需要重启应用；再次读取失败时继续使用默认配置。
