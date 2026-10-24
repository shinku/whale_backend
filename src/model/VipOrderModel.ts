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
  tableName: 'vip_order',
  comment: '会员购买订单，order_no 同时作为微信 out_trade_no',
  indexes: [
    {
      name: 'uk_vip_order_order_no',
      unique: true,
      fields: ['order_no'],
    },
    {
      name: 'uk_vip_order_transaction_id',
      unique: true,
      fields: ['transaction_id'],
    },
    {
      name: 'idx_vip_order_user_status_created',
      fields: ['user_id', 'status', 'created_at'],
    },
  ],
})
export class VipOrderModel extends Model {
  @Column({
    type: DataType.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: number;

  @Column({
    type: DataType.STRING(32),
    allowNull: false,
  })
  order_no!: string;

  @Column({
    type: DataType.STRING(64),
    allowNull: false,
    comment: '用户 openid',
  })
  user_id!: string;

  @Column({
    type: DataType.STRING(32),
    allowNull: false,
  })
  plan_id!: string;

  @Column({
    type: DataType.JSON,
    allowNull: false,
    comment: '下单时的套餐名称、价格、时长、会员类型快照',
  })
  plan_snapshot!: Record<string, unknown>;

  @Column({
    type: DataType.INTEGER.UNSIGNED,
    allowNull: false,
  })
  amount_cents!: number;

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
    comment: 'CREATING|PENDING|PAID|CLOSED|FAILED|REFUNDED',
  })
  status!: string;

  @Column({
    type: DataType.STRING(64),
    allowNull: true,
  })
  prepay_id!: string | null;

  @Column({
    type: DataType.STRING(64),
    allowNull: true,
  })
  transaction_id!: string | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  paid_at!: Date | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  membership_start_at!: Date | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  membership_end_at!: Date | null;

  @Column({
    type: DataType.STRING(20),
    allowNull: true,
  })
  refund_status!: string | null;

  @Column({
    type: DataType.STRING(64),
    allowNull: true,
    comment: '脱敏后的最近一次微信错误码',
  })
  last_wx_error_code!: string | null;

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
