import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'app_info',
})
export class AppModel extends Model {
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
  app_id: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  app_secret: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  app_name: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  lane: string;
}
