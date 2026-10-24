# 后台管理接口文档

## 运营管理接口

### GET /operator/
- 描述：获取运维数据列表
- 参数：
  - query.lane: 通道标识，默认'whale'
  - query.offset: 偏移量，默认0
  - query.limit: 每页数量，默认10

### POST /operator/add  
- 描述：新增运维数据
- 参数：
  - body.icon: 活动icon
  - body.name: 活动名称
  - body.available_start: 开始时间
  - body.config: 配置项
  - body.available_end: 结束时间(可选)

### PUT /operator/set/:oId
- 描述：更新运维数据
- 参数：
  - params.oId: 运营数据ID
  - body.icon: 活动icon(可选)
  - body.name: 活动名称(可选)
  - body.available_start: 开始时间(可选)
  - body.config: 配置项(可选)
  - body.available_end: 结束时间(可选)

## Banner管理接口

### GET /banner/
- 描述：获取banner数据
- 参数：
  - query.lane: 通道标识，默认'whale'
  - query.status: 状态，默认'active'

### PUT /banner/
- 描述：更新banner
- 参数：
  - body.id: banner ID(必填)
  - body.status: 状态(可选)
  - body.banner_image: 图片(可选)
  - body.action: 动作(可选)

### POST /banner/
- 描述：增加banner位置
- 参数：
  - body.banner_image: 图片
  - body.action: 动作
  - body.lane: 通道标识，默认'whale'

## 通知管理接口

### GET /notification/
- 描述：获取通知信息

### PUT /notification/update
- 描述：更新通知信息

## 用户管理接口

### GET /user/
- 描述：获取用户列表
- 参数：
  - query.limit: 每页数量，默认20
  - query.offset: 偏移量，默认0
- 响应中的会员字段：
  - vip_type: 最近一笔已支付订单的会员类型；无订单时为 `guest`
  - vip_name: 套餐名称
  - vip_order_no: 最近一笔有效购买订单号，管理员退款时使用
  - available_start: 会员生效时间
  - available_end: 会员结束时间
  - vip_active: 当前是否在有效期内

### GET /user/:userid
- 描述：获取用户详情
- 参数：
  - params.userid: 用户 openid
- 响应会员字段与用户列表一致。

### POST /vip/refund/:openid
- 描述：退款指定用户最新一笔仍有效的购买记录
- 参数：
  - params.openid: 用户 openid
  - body.orderNo: 待退款订单号，必须与当前最新有效订单一致
  - body.reason: 退款原因，可选
  - header.x-operator-id: 后台操作人，可选
- 限制：
  - 只能全额退款最新一笔 `PAID` 且未过期的订单
  - 退款处理中不能再次购买
  - 退款成功后将订单改为 `REFUNDED`，会员信息自动回退到上一笔仍有效的订单
  - 完全相同的重复退款请求返回原退款单，不会重复退款
