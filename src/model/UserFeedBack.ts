import { Column, DataType, Default, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'user_feedback',
})
export class UserFeedBack extends Model {
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

  @Default('whale')
  @Column({
    type: DataType.STRING,
    allowNull: false,
    comment: '反馈渠道',
  })
  lane: string;
}
