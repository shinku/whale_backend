import { Column, DataType, Default, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'user_feedback',
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
    allowNull: false,
  })
  message: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  feedback_img: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    comment: '反馈渠道',
  })
  @Default('whale')
  lane: string;
}
