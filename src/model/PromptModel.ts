import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'prompt_act',
})
export class PromptModel extends Model {
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
  act_name: string;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  prompt: string;
}
