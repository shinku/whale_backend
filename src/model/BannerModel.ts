import {
  Column,
  DataType,
  Default,
  Index,
  Model,
  Table,
} from 'sequelize-typescript';

@Table({
  tableName: 'banner',
})
export class BannerModel extends Model {
  @Column({
    type: DataType.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  })
  id: number;

  @Default('whale')
  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  lane: string;

  @Index
  @Column({
    type: DataType.STRING,
    comment: 'active/deactive',
    allowNull: false,
  })
  status: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    comment: '跳转链接',
  })
  action: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    comment: 'banner name',
  })
  name: string;

  @Index
  @Default('normal')
  @Column({
    type: DataType.STRING,
    allowNull: false,
    comment: 'banner type : normal/icon',
  })
  type: string;

  @Column({
    type: DataType.STRING,
    comment: 'banner image',
    allowNull: false,
  })
  banner_image: string;
}
