import { Column, DataType, Model, Table } from 'sequelize-typescript';

/**
 * AI 出题结果存储（POST /api/ai/subjects 的产物）
 *
 * 每条记录保留 24 小时，过期数据由 AiSubjectStoreTask 每小时清理一次。
 * createdAt / updatedAt 由 sequelize 自动维护，过期判断使用 createdAt。
 */
@Table({
  tableName: 'ai_subject_store',
  comment: 'AI 出题结果存储，有效期 24 小时',
  indexes: [
    {
      name: 'idx_ai_subject_store_requestid',
      fields: ['requestid'],
    },
  ],
})
export class AiSubjectStoreModel extends Model {
  @Column({
    type: DataType.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: number;

  @Column({
    type: DataType.STRING(64),
    allowNull: false,
    comment: '接口返回给前端的唯一请求 id（uuid）',
  })
  requestid!: string;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
    comment: '（模型返回的纯文本）',
  })
  store_content!: string;
}
