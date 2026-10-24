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
  tableName: 'vip_plan',
  comment: '可售会员套餐配置，价格统一使用整数分',
  indexes: [
    {
      name: 'uk_vip_plan_plan_id',
      unique: true,
      fields: ['plan_id'],
    },
    {
      name: 'idx_vip_plan_enabled_sort',
      fields: ['enabled', 'sort'],
    },
  ],
})
export class VipPlanModel extends Model {
  @Column({
    type: DataType.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: number;

  @Column({
    type: DataType.STRING(32),
    allowNull: false,
    comment: '稳定套餐 ID',
  })
  plan_id!: string;

  @Column({
    type: DataType.STRING(64),
    allowNull: false,
  })
  name!: string;

  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    comment: 'monthly|quarterly|yearly',
  })
  member_type!: string;

  @Column({
    type: DataType.INTEGER.UNSIGNED,
    allowNull: false,
  })
  duration_days!: number;

  @Column({
    type: DataType.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '售价，单位分',
  })
  price_cents!: number;

  @Column({
    type: DataType.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '划线价，单位分',
  })
  original_price_cents!: number;

  @Default('')
  @Column({
    type: DataType.STRING(32),
    allowNull: false,
  })
  badge!: string;

  @Default('')
  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  description!: string;

  @Default(false)
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
  })
  recommended!: boolean;

  @Default(true)
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    comment: '是否可售',
  })
  enabled!: boolean;

  @Default(0)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  sort!: number;

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
