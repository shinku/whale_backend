import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'user_point_consume_logs',
})
export class UserPointConsumeLogsModel extends Model {
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
    type: DataType.INTEGER,
    allowNull: true,
  })
  amount_modify: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    comment: '消费类型，增加或者减少：decline/increase',
  })
  modify_type: string;
}
