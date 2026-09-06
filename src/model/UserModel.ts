import { Column, DataType, Default, Model, Table } from 'sequelize-typescript';
import { DEFAULT_USER_COUNT_LIMIT } from '../core/limits';

@Table({
  tableName: 'user',
})
export class UserModel extends Model {
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
  openid!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  user_name!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  user_avator!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  user_mobile!: string;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: true,
  })
  agree_first_deal!: boolean;

  @Default('whale')
  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  lane!: string;

  @Default(DEFAULT_USER_COUNT_LIMIT)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    comment: '清除手写剩余次数',
  })
  count_clear_hands_write_limit!: number;

  @Default(DEFAULT_USER_COUNT_LIMIT)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    comment: '文件转换剩余次数',
  })
  count_convert_file_limit!: number;

  @Default(DEFAULT_USER_COUNT_LIMIT)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    comment: '多图转文件剩余次数',
  })
  count_expend_2_file_limit!: number;

  @Default(DEFAULT_USER_COUNT_LIMIT)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    comment: '文本转 word 剩余次数',
  })
  count_text_2_word_limit!: number;

  @Column({
    type: DataType.DATE,
    allowNull: true,
    comment: '时间限制，暂时预留',
  })
  time_limit!: Date | null;
}
