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

### GET /user/:userid
- 描述：获取用户详情
- 参数：
  - params.userid: 用户ID
