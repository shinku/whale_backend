-- 所有 AI 生成结果都通过 requestid（UUID）查询。
ALTER TABLE `ai_subject_store`
  DROP INDEX `idx_ai_subject_store_requestid`,
  ADD UNIQUE KEY `idx_ai_subject_store_requestid` (`requestid`);
