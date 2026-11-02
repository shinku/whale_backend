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
  tableName: 'beta_limited_table',
  comment: 'Beta 功能每日调用次数',
  indexes: [
    {
      name: 'uk_beta_limited_user_feature_date',
      unique: true,
      fields: ['user_id', 'feature', 'usage_date'],
    },
  ],
})
export class BetaLimitedModel extends Model {
  @Column({
    type: DataType.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: number;

  @Column({
    type: DataType.STRING(64),
    allowNull: false,
    comment: '用户 openid',
  })
  user_id!: string;

  @Column({
    type: DataType.STRING(64),
    allowNull: false,
    comment: '功能标识',
  })
  feature!: string;

  @Column({
    type: DataType.DATEONLY,
    allowNull: false,
    comment: '北京时间自然日 YYYY-MM-DD',
  })
  usage_date!: string;

  @Default(0)
  @Column({
    type: DataType.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '当日已调用次数',
  })
  used_count!: number;

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
