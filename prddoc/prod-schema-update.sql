-- 微信小程序后端线上表结构升级
-- 适用：MySQL 8.0，执行前请完整备份数据库。
-- 约定：本文件不删除表、不删除业务数据。

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- 0. 执行前检查
-- ---------------------------------------------------------------------------

-- 必须返回 0 行，才能创建 user_vip_record.user_id 唯一索引。
SELECT
  `user_id`,
  COUNT(*) AS `duplicate_count`
FROM `user_vip_record`
WHERE `user_id` IS NOT NULL
GROUP BY `user_id`
HAVING COUNT(*) > 1;

-- 可先备份有重复数据的用户会员记录，例如：
-- CREATE TABLE `user_vip_record_backup_20261031` AS
-- SELECT * FROM `user_vip_record`;

-- ---------------------------------------------------------------------------
-- 1. 旧表兼容变更
-- ---------------------------------------------------------------------------

-- 用户会员汇总按 user_id 唯一，避免并发 findOrCreate 产生重复记录。
-- 如果第 0 步查询有结果，必须先人工合并重复数据再执行本语句。
ALTER TABLE `user_vip_record`
  ADD UNIQUE KEY `uk_user_vip_record_user_id` (`user_id`);

-- ---------------------------------------------------------------------------
-- 2. 新增表
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `ai_subject_store` (
  `id` int NOT NULL AUTO_INCREMENT,
  `requestid` varchar(64) NOT NULL COMMENT '接口返回给前端的唯一请求 id（uuid）',
  `store_content` text NOT NULL COMMENT '出题结果（模型返回的纯文本）',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ai_subject_store_requestid` (`requestid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 出题结果存储，有效期 24 小时';

CREATE TABLE IF NOT EXISTS `vip_plan` (
  `id` int NOT NULL AUTO_INCREMENT,
  `plan_id` varchar(32) NOT NULL COMMENT '稳定套餐 ID',
  `name` varchar(64) NOT NULL,
  `member_type` varchar(20) NOT NULL COMMENT 'monthly|quarterly|yearly',
  `duration_days` int unsigned NOT NULL,
  `price_cents` int unsigned NOT NULL COMMENT '售价，单位分',
  `original_price_cents` int unsigned NOT NULL COMMENT '划线价，单位分',
  `badge` varchar(32) NOT NULL DEFAULT '',
  `description` varchar(255) NOT NULL DEFAULT '',
  `recommended` tinyint(1) NOT NULL DEFAULT '0',
  `enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否可售',
  `sort` int NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_vip_plan_plan_id` (`plan_id`),
  KEY `idx_vip_plan_enabled_sort` (`enabled`, `sort`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='可售会员套餐配置，价格统一使用整数分';

CREATE TABLE IF NOT EXISTS `vip_order` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_no` varchar(32) DEFAULT NULL
    COMMENT '微信 out_trade_no；guest/infinity 授予记录为空',
  `user_id` varchar(64) NOT NULL COMMENT '用户 openid',
  `plan_id` varchar(32) NOT NULL,
  `plan_snapshot` json NOT NULL COMMENT '下单时的套餐名称、价格、时长、会员类型快照',
  `amount_cents` int unsigned NOT NULL,
  `currency` char(3) NOT NULL DEFAULT 'CNY',
  `status` varchar(20) NOT NULL DEFAULT 'CREATING'
    COMMENT 'CREATING|PENDING|PAID|CLOSED|FAILED|REFUNDED|GRANTED',
  `prepay_id` varchar(64) DEFAULT NULL,
  `transaction_id` varchar(64) DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `membership_start_at` datetime DEFAULT NULL,
  `membership_end_at` datetime DEFAULT NULL,
  `refund_status` varchar(20) DEFAULT NULL,
  `last_wx_error_code` varchar(64) DEFAULT NULL COMMENT '脱敏后的最近一次微信错误码',
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_vip_order_order_no` (`order_no`),
  UNIQUE KEY `uk_vip_order_transaction_id` (`transaction_id`),
  KEY `idx_vip_order_user_status_created` (`user_id`, `status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='会员订单及 guest/infinity 授予记录';

-- 兼容已经提前执行过 vip_order 建表的情况。
ALTER TABLE `vip_order`
  MODIFY `order_no` varchar(32) DEFAULT NULL
    COMMENT '微信 out_trade_no；guest/infinity 授予记录为空',
  MODIFY `status` varchar(20) NOT NULL DEFAULT 'CREATING'
    COMMENT 'CREATING|PENDING|PAID|CLOSED|FAILED|REFUNDED|GRANTED';

CREATE TABLE IF NOT EXISTS `vip_transaction` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_no` varchar(32) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `transaction_id` varchar(64) NOT NULL,
  `trade_state` varchar(32) NOT NULL COMMENT 'SUCCESS|REFUND 等微信交易状态',
  `amount_cents` int unsigned NOT NULL,
  `currency` char(3) NOT NULL DEFAULT 'CNY',
  `source` varchar(20) NOT NULL DEFAULT 'CALLBACK' COMMENT 'CALLBACK|QUERY',
  `payload_summary` json NOT NULL
    COMMENT '通过校验后的交易摘要，不保存密钥和完整回调原文',
  `paid_at` datetime NOT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_vip_transaction_order_no` (`order_no`),
  UNIQUE KEY `uk_vip_transaction_transaction_id` (`transaction_id`),
  KEY `idx_vip_transaction_user_paid` (`user_id`, `paid_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会员订单的微信交易结果，order_no 唯一保证幂等';

CREATE TABLE IF NOT EXISTS `vip_refund` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `out_refund_no` varchar(64) NOT NULL
    COMMENT '本系统退款单号，同时作为微信 out_refund_no',
  `order_no` varchar(32) NOT NULL COMMENT '关联的 vip_order.order_no',
  `user_id` varchar(64) NOT NULL COMMENT '用户 openid',
  `transaction_id` varchar(64) NOT NULL COMMENT '原微信支付交易号',
  `wx_refund_id` varchar(64) DEFAULT NULL COMMENT '微信退款单号',
  `amount_cents` int unsigned NOT NULL COMMENT '本次退款金额，单位分',
  `total_cents` int unsigned NOT NULL COMMENT '原订单实付金额，单位分',
  `currency` char(3) NOT NULL DEFAULT 'CNY',
  `status` varchar(20) NOT NULL DEFAULT 'CREATING'
    COMMENT 'CREATING|PROCESSING|SUCCESS|ABNORMAL|CLOSED|FAILED',
  `reason` varchar(255) NOT NULL DEFAULT '' COMMENT '退款原因',
  `operator_id` varchar(64) DEFAULT NULL COMMENT '发起退款的后台操作人',
  `last_wx_error_code` varchar(64) DEFAULT NULL COMMENT '脱敏后的微信退款错误码',
  `payload_summary` json DEFAULT NULL
    COMMENT '脱敏后的微信退款结果摘要，不保存密钥和完整回调明文',
  `requested_at` datetime NOT NULL,
  `succeeded_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_vip_refund_out_refund_no` (`out_refund_no`),
  UNIQUE KEY `uk_vip_refund_wx_refund_id` (`wx_refund_id`),
  KEY `idx_vip_refund_order_no` (`order_no`),
  KEY `idx_vip_refund_user_requested` (`user_id`, `requested_at`),
  KEY `idx_vip_refund_status_requested` (`status`, `requested_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会员订单退款明细，一次退款申请一条记录';

CREATE TABLE IF NOT EXISTS `wechat_message_push_record` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `event_name` varchar(64) DEFAULT NULL,
  `openid` varchar(64) DEFAULT NULL,
  `out_trade_no` varchar(64) DEFAULT NULL,
  `env` tinyint unsigned DEFAULT NULL COMMENT '0 现网环境，1 沙箱环境',
  `product_id` varchar(64) DEFAULT NULL,
  `quantity` int unsigned DEFAULT NULL,
  `content` text NOT NULL COMMENT '解密后的推送内容，UTF-8 文本',
  `status` varchar(20) NOT NULL DEFAULT 'RECEIVED'
    COMMENT 'RECEIVED|PROCESSED|IGNORED|FAILED',
  `error_message` text,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wx_message_push_event_created` (`event_name`, `created_at`),
  KEY `idx_wx_message_push_openid_created` (`openid`, `created_at`),
  KEY `idx_wx_message_push_order_no` (`out_trade_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='微信消息推送记录';

-- ---------------------------------------------------------------------------
-- 3. 可选：严格对齐模型中的 NOT NULL 约束
-- ---------------------------------------------------------------------------
-- 以下语句不会自动执行。先逐表确认不存在 NULL，再解除注释。
-- 无法凭空补齐 app_id、openid、URL 等业务字段，存在 NULL 时应先人工处理。

-- SELECT 'app_info' AS table_name, COUNT(*) AS invalid_rows FROM `app_info`
--   WHERE `app_id` IS NULL OR `app_secret` IS NULL
--      OR `createdAt` IS NULL OR `updatedAt` IS NULL;
-- SELECT 'app_operate' AS table_name, COUNT(*) AS invalid_rows FROM `app_operate`
--   WHERE `type` IS NULL OR `config` IS NULL OR `available_start` IS NULL
--      OR `lane` IS NULL OR `createdAt` IS NULL OR `updatedAt` IS NULL;
-- SELECT 'banner' AS table_name, COUNT(*) AS invalid_rows FROM `banner`
--   WHERE `lane` IS NULL OR `status` IS NULL OR `action` IS NULL
--      OR `name` IS NULL OR `type` IS NULL OR `banner_image` IS NULL
--      OR `createdAt` IS NULL OR `updatedAt` IS NULL;
-- SELECT 'edu_news' AS table_name, COUNT(*) AS invalid_rows FROM `edu_news`
--   WHERE `title` IS NULL OR `content` IS NULL OR `source` IS NULL
--      OR `url` IS NULL OR `category` IS NULL OR `available` IS NULL
--      OR `createdAt` IS NULL OR `updatedAt` IS NULL;
-- SELECT 'prompt_act' AS table_name, COUNT(*) AS invalid_rows FROM `prompt_act`
--   WHERE `act_name` IS NULL OR `prompt` IS NULL
--      OR `createdAt` IS NULL OR `updatedAt` IS NULL;
-- SELECT 'user' AS table_name, COUNT(*) AS invalid_rows FROM `user`
--   WHERE `openid` IS NULL OR `lane` IS NULL
--      OR `createdAt` IS NULL OR `updatedAt` IS NULL;
-- SELECT 'user_feedback' AS table_name, COUNT(*) AS invalid_rows FROM `user_feedback`
--   WHERE `user_id` IS NULL OR `message` IS NULL OR `lane` IS NULL
--      OR `createdAt` IS NULL OR `updatedAt` IS NULL;
-- SELECT 'user_limit_table' AS table_name, COUNT(*) AS invalid_rows FROM `user_limit_table`
--   WHERE `user_id` IS NULL OR `lane` IS NULL OR `limit_type` IS NULL
--      OR `createdAt` IS NULL OR `updatedAt` IS NULL;
-- SELECT 'user_point' AS table_name, COUNT(*) AS invalid_rows FROM `user_point`
--   WHERE `user_id` IS NULL OR `createdAt` IS NULL OR `updatedAt` IS NULL;
-- SELECT 'user_point_consume_logs' AS table_name, COUNT(*) AS invalid_rows
--   FROM `user_point_consume_logs`
--   WHERE `user_id` IS NULL OR `createdAt` IS NULL OR `updatedAt` IS NULL;
-- SELECT 'user_record_cleanpaper_image' AS table_name, COUNT(*) AS invalid_rows
--   FROM `user_record_cleanpaper_image`
--   WHERE `user_id` IS NULL OR `lane` IS NULL
--      OR `image_url_before` IS NULL OR `image_url_after` IS NULL
--      OR `createdAt` IS NULL OR `updatedAt` IS NULL;
-- SELECT 'user_vip_record' AS table_name, COUNT(*) AS invalid_rows FROM `user_vip_record`
--   WHERE `user_id` IS NULL OR `type` IS NULL OR `available_start` IS NULL
--      OR `createdAt` IS NULL OR `updatedAt` IS NULL;

-- 所有检查均返回 0 后，可按需执行：
-- ALTER TABLE `app_info`
--   MODIFY `app_id` varchar(255) NOT NULL,
--   MODIFY `app_secret` varchar(255) NOT NULL,
--   MODIFY `createdAt` datetime NOT NULL,
--   MODIFY `updatedAt` datetime NOT NULL;
-- ALTER TABLE `app_operate`
--   MODIFY `type` varchar(255) NOT NULL DEFAULT 'webview' COMMENT 'page/webview/miniapp',
--   MODIFY `config` json NOT NULL,
--   MODIFY `available_start` datetime NOT NULL,
--   MODIFY `lane` varchar(255) NOT NULL DEFAULT 'whale',
--   MODIFY `createdAt` datetime NOT NULL,
--   MODIFY `updatedAt` datetime NOT NULL;
-- ALTER TABLE `banner`
--   MODIFY `lane` varchar(255) NOT NULL DEFAULT 'whale',
--   MODIFY `status` varchar(255) NOT NULL COMMENT 'active/deactive',
--   MODIFY `action` varchar(255) NOT NULL COMMENT '跳转链接',
--   MODIFY `name` varchar(255) NOT NULL COMMENT 'banner name',
--   MODIFY `type` varchar(255) NOT NULL DEFAULT 'normal' COMMENT 'banner type : normal/icon',
--   MODIFY `banner_image` varchar(255) NOT NULL COMMENT 'banner image',
--   MODIFY `createdAt` datetime NOT NULL,
--   MODIFY `updatedAt` datetime NOT NULL;
-- ALTER TABLE `edu_news`
--   MODIFY `title` varchar(512) NOT NULL COMMENT '新闻标题',
--   MODIFY `content` text NOT NULL COMMENT '新闻主体（Markdown，图片为 OSS 地址）',
--   MODIFY `source` varchar(128) NOT NULL DEFAULT '' COMMENT '新闻来源',
--   MODIFY `url` varchar(512) NOT NULL COMMENT '原文链接，唯一索引用于去重',
--   MODIFY `category` varchar(64) NOT NULL DEFAULT '教育政策' COMMENT '分类，如 教育政策',
--   MODIFY `available` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否可用，默认 true',
--   MODIFY `createdAt` datetime NOT NULL,
--   MODIFY `updatedAt` datetime NOT NULL;
-- ALTER TABLE `prompt_act`
--   MODIFY `act_name` varchar(255) NOT NULL,
--   MODIFY `prompt` text NOT NULL,
--   MODIFY `createdAt` datetime NOT NULL,
--   MODIFY `updatedAt` datetime NOT NULL;
-- ALTER TABLE `user`
--   MODIFY `openid` varchar(255) NOT NULL,
--   MODIFY `lane` varchar(255) NOT NULL DEFAULT 'whale',
--   MODIFY `createdAt` datetime NOT NULL,
--   MODIFY `updatedAt` datetime NOT NULL;
-- ALTER TABLE `user_feedback`
--   MODIFY `user_id` varchar(255) NOT NULL,
--   MODIFY `message` varchar(255) NOT NULL,
--   MODIFY `lane` varchar(255) NOT NULL DEFAULT 'whale' COMMENT '反馈渠道',
--   MODIFY `createdAt` datetime NOT NULL,
--   MODIFY `updatedAt` datetime NOT NULL;
-- ALTER TABLE `user_limit_table`
--   MODIFY `user_id` varchar(255) NOT NULL COMMENT '用户 openid',
--   MODIFY `lane` varchar(255) NOT NULL DEFAULT 'whale',
--   MODIFY `limit_type` varchar(255) NOT NULL
--     COMMENT '限制类型：count_clear_hands_write_limit / count_convert_file_limit / count_expend_2_file_limit / count_error_collect_limit / count_text_2_word_limit / time_date',
--   MODIFY `createdAt` datetime NOT NULL,
--   MODIFY `updatedAt` datetime NOT NULL;
-- ALTER TABLE `user_point`
--   MODIFY `user_id` varchar(255) NOT NULL,
--   MODIFY `createdAt` datetime NOT NULL,
--   MODIFY `updatedAt` datetime NOT NULL;
-- ALTER TABLE `user_point_consume_logs`
--   MODIFY `user_id` varchar(255) NOT NULL,
--   MODIFY `createdAt` datetime NOT NULL,
--   MODIFY `updatedAt` datetime NOT NULL;
-- ALTER TABLE `user_record_cleanpaper_image`
--   MODIFY `user_id` varchar(255) NOT NULL,
--   MODIFY `lane` varchar(255) NOT NULL,
--   MODIFY `image_url_before` varchar(255) NOT NULL,
--   MODIFY `image_url_after` varchar(255) NOT NULL,
--   MODIFY `createdAt` datetime NOT NULL,
--   MODIFY `updatedAt` datetime NOT NULL;
-- ALTER TABLE `user_vip_record`
--   MODIFY `user_id` varchar(255) NOT NULL,
--   MODIFY `type` varchar(20) NOT NULL
--     COMMENT 'guest|monthly|quarterly|yearly|infinity，兼容历史 vip|svip',
--   MODIFY `available_start` datetime NOT NULL COMMENT '会员生效时间',
--   MODIFY `createdAt` datetime NOT NULL,
--   MODIFY `updatedAt` datetime NOT NULL;
