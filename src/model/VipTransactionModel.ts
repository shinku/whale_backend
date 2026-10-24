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
  tableName: 'vip_transaction',
  comment: '会员订单的微信交易结果，order_no 唯一保证幂等',
  indexes: [
    {
      name: 'uk_vip_transaction_order_no',
      unique: true,
      fields: ['order_no'],
    },
    {
      name: 'uk_vip_transaction_transaction_id',
      unique: true,
      fields: ['transaction_id'],
    },
    {
      name: 'idx_vip_transaction_user_paid',
      fields: ['user_id', 'paid_at'],
    },
  ],
})
export class VipTransactionModel extends Model {
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
  })
  user_id!: string;

  @Column({
    type: DataType.STRING(64),
    allowNull: false,
  })
  transaction_id!: string;

  @Column({
    type: DataType.STRING(32),
    allowNull: false,
    comment: 'SUCCESS|REFUND 等微信交易状态',
  })
  trade_state!: string;

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

  @Default('CALLBACK')
  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    comment: 'CALLBACK|QUERY',
  })
  source!: string;

  @Column({
    type: DataType.JSON,
    allowNull: false,
    comment: '通过校验后的交易摘要，不保存密钥和完整回调原文',
  })
  payload_summary!: Record<string, unknown>;

  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  paid_at!: Date;

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
