import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'user_vip_record',
  comment: '用户当前会员权益',
  indexes: [
    {
      name: 'uk_user_vip_record_user_id',
      unique: true,
      fields: ['user_id'],
    },
  ],
})
export class UserVipModel extends Model {
  @Column({
    type: DataType.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  user_id!: string;

  @Column({
    type: DataType.STRING(20),
    comment: 'guest|monthly|quarterly|yearly，兼容历史 vip|svip',
    allowNull: false,
  })
  type!: string;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    comment: '会员生效时间',
  })
  available_start!: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
    comment: '会员结束时间',
  })
  available_end!: Date;
}
