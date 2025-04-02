import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'user_record_cleanpaper_image',
})
export class UserRecordModel extends Model {
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
  lane: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  image_url_before: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  image_url_after: string;
}
