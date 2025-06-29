import { Column, DataType, Default, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'app_operate',
  comment: '活动运营表',
})
export class AppOperateModel extends Model {
  @Column({
    type: DataType.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  })
  id: number;

  @Column({
    type: DataType.STRING,
  })
  operator_id: string;

  @Column({
    type: DataType.STRING,
    comment: '活动icon',
  })
  icon: string;

  @Column({
    type: DataType.STRING,
    comment: '运营活动名称',
  })
  name: string;

  @Default('webview')
  @Column({
    type: DataType.STRING,
    comment: 'page/webview/miniapp',
    allowNull: false,
  })
  type: string;

  @Column({
    type: DataType.JSON,
    allowNull: false,
  })
  config: object;

  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  available_start: number;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  available_end: number;

  @Default('whale')
  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  lane: string;
}
