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
  tableName: 'vip_refund',
  comment: '会员订单退款明细，一次退款申请一条记录',
  indexes: [
    {
      name: 'uk_vip_refund_out_refund_no',
      unique: true,
      fields: ['out_refund_no'],
    },
    {
      name: 'uk_vip_refund_wx_refund_id',
      unique: true,
      fields: ['wx_refund_id'],
    },
    {
      name: 'idx_vip_refund_order_no',
      fields: ['order_no'],
    },
    {
      name: 'idx_vip_refund_user_requested',
      fields: ['user_id', 'requested_at'],
    },
    {
      name: 'idx_vip_refund_status_requested',
      fields: ['status', 'requested_at'],
    },
  ],
})
export class VipRefundModel extends Model {
  @Column({
    type: DataType.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: number;

  @Column({
    type: DataType.STRING(64),
    allowNull: false,
    comment: '本系统退款单号，同时作为微信 out_refund_no',
  })
  out_refund_no!: string;

  @Column({
    type: DataType.STRING(32),
    allowNull: false,
    comment: '关联的 vip_order.order_no',
  })
  order_no!: string;

  @Column({
    type: DataType.STRING(64),
    allowNull: false,
    comment: '用户 openid',
  })
  user_id!: string;

  @Column({
    type: DataType.STRING(64),
    allowNull: false,
    comment: '原微信支付交易号',
  })
  transaction_id!: string;

  @Column({
    type: DataType.STRING(64),
    allowNull: true,
    comment: '微信退款单号',
  })
  wx_refund_id!: string | null;

  @Column({
    type: DataType.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '本次退款金额，单位分',
  })
  amount_cents!: number;

  @Column({
    type: DataType.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '原订单实付金额，单位分',
  })
  total_cents!: number;

  @Default('CNY')
  @Column({
    type: DataType.CHAR(3),
    allowNull: false,
  })
  currency!: string;

  @Default('CREATING')
  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    comment: 'CREATING|PROCESSING|SUCCESS|ABNORMAL|CLOSED|FAILED',
  })
  status!: string;

  @Default('')
  @Column({
    type: DataType.STRING(255),
    allowNull: false,
    comment: '退款原因',
  })
  reason!: string;

  @Column({
    type: DataType.STRING(64),
    allowNull: true,
    comment: '发起退款的后台操作人',
  })
  operator_id!: string | null;

  @Column({
    type: DataType.STRING(64),
    allowNull: true,
    comment: '脱敏后的微信退款错误码',
  })
  last_wx_error_code!: string | null;

  @Column({
    type: DataType.JSON,
    allowNull: true,
    comment: '脱敏后的微信退款结果摘要，不保存密钥和完整回调明文',
  })
  payload_summary!: Record<string, unknown> | null;

  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  requested_at!: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  succeeded_at!: Date | null;

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
