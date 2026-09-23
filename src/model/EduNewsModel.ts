import { Column, DataType, Default, Model, Table } from 'sequelize-typescript';

/**
 * 教育新闻（含教育政策相关新闻）
 */
@Table({
  tableName: 'edu_news',
  indexes: [
    {
      name: 'uk_edu_news_url',
      unique: true,
      fields: ['url'],
    },
    {
      name: 'idx_edu_news_publish_time',
      fields: ['publish_time'],
    },
    {
      name: 'idx_edu_news_available',
      fields: ['available'],
    },
  ],
})
export class EduNewsModel extends Model {
  @Column({
    type: DataType.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: number;

  @Column({
    type: DataType.STRING(512),
    allowNull: false,
    comment: '新闻标题',
  })
  title!: string;

  @Column({
    type: DataType.DATE,
    allowNull: true,
    comment: '新闻时间（原文发稿时间）',
  })
  publish_time!: Date;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
    comment: '新闻主体（Markdown，图片为 OSS 地址）',
  })
  content!: string;

  @Default('')
  @Column({
    type: DataType.STRING(128),
    allowNull: false,
    comment: '新闻来源',
  })
  source!: string;

  @Column({
    type: DataType.STRING(512),
    allowNull: false,
    comment: '原文链接，唯一索引用于去重',
  })
  url!: string;

  @Default('教育政策')
  @Column({
    type: DataType.STRING(64),
    allowNull: false,
    comment: '分类，如 教育政策',
  })
  category!: string;

  @Default(true)
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    comment: '是否可用，默认 true',
  })
  available!: boolean;

  @Column({
    type: DataType.DATE,
    allowNull: true,
    comment: '采集入库时间',
  })
  collected_at!: Date;
}
