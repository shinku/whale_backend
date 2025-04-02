import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'user',
})
export class UserModel extends Model {
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
    allowNull: true,
  })
  user_name: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  user_avator: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  user_mobile: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  lane: string;
}
