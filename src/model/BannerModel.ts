import { Column, DataType, Default, Model, Table } from 'sequelize-typescript';

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

  @Column({
    type: DataType.STRING,
    comment: 'active/deactive',
    allowNull: false,
  })
  status: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  action: string;

  @Column({
    type: DataType.STRING,
    comment: 'banner image',
    allowNull: false,
  })
  banner_image: string;
}
