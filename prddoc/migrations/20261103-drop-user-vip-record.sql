-- 会员状态已统一从 vip_order 派生，user_vip_record 不再写入或读取。
DROP TABLE IF EXISTS `user_vip_record`;
