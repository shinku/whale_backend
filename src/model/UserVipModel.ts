import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'user_vip_record',
})
export class UserVipModel extends Model {
  @Column({
    type: DataType.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  })
  id: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  user_id: string;

  @Column({
    type: DataType.STRING,
    comment: 'guest|vip|svip',
    allowNull: false,
  })
  type: string;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    comment: '会员生效时间',
  })
  available_start: number;

  @Column({
    type: DataType.DATE,
    allowNull: true,
    comment: '会员结束时间',
  })
  available_end: number;
}
