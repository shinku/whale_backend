import { Column, DataType, Default, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'user_limit_table',
  comment: '用户次数/时间限制表',
})
export class UserLimitModel extends Model {
  @Column({
    type: DataType.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    comment: '用户 openid',
  })
  user_id!: string;

  @Default('whale')
  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  lane!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    comment:
      '限制类型：count_clear_hands_write_limit / count_convert_file_limit / count_expend_2_file_limit / count_text_2_word_limit / time_date',
  })
  limit_type!: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    comment: '剩余次数，countlimit 类型使用，可为空',
  })
  limit_count!: number | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
    comment: '过期时间，time_date 类型使用，可为空',
  })
  limit_date!: Date | null;
}
