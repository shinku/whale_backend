import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'user_point',
})
export class UserPointModel extends Model {
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
  amount: string;
}
