import {
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';

@Table({
  tableName: 'wechat_message_push_record',
  comment: '微信消息推送记录',
  indexes: [
    {
      name: 'idx_wx_message_push_event_created',
      fields: ['event_name', 'created_at'],
    },
    {
      name: 'idx_wx_message_push_openid_created',
      fields: ['openid', 'created_at'],
    },
    {
      name: 'idx_wx_message_push_order_no',
      fields: ['out_trade_no'],
    },
  ],
})
export class WechatMessagePushRecordModel extends Model {
  @Column({
    type: DataType.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: number;

  @Column({
    type: DataType.STRING(64),
    allowNull: true,
  })
  event_name!: string | null;

  @Column({
    type: DataType.STRING(64),
    allowNull: true,
  })
  openid!: string | null;

  @Column({
    type: DataType.STRING(64),
    allowNull: true,
  })
  out_trade_no!: string | null;

  @Column({
    type: DataType.TINYINT.UNSIGNED,
    allowNull: true,
    comment: '0 现网环境，1 沙箱环境',
  })
  env!: number | null;

  @Column({
    type: DataType.STRING(64),
    allowNull: true,
  })
  product_id!: string | null;

  @Column({
    type: DataType.INTEGER.UNSIGNED,
    allowNull: true,
  })
  quantity!: number | null;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
    comment: '解密后的推送内容，UTF-8 文本',
  })
  content!: string;

  @Default('RECEIVED')
  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    comment: 'RECEIVED|PROCESSED|IGNORED|FAILED',
  })
  status!: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  error_message!: string | null;

  @CreatedAt
  @Column({
    type: DataType.DATE,
    field: 'created_at',
  })
  created_at!: Date;

  @UpdatedAt
  @Column({
    type: DataType.DATE,
    field: 'updated_at',
  })
  updated_at!: Date;
}
