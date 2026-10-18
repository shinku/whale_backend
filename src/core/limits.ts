/**
 * 新用户默认的 countlimit 次数，目前 limit 相关都初始化为 10
 */
export const DEFAULT_USER_COUNT_LIMIT = 10;

/**
 * lisence_type = countlimit 时，
 * user_limit_table.limit_type 中需要初始化的次数限制类型
 */
export const USER_COUNT_LIMIT_FIELDS = [
  'count_clear_hands_write_limit',
  'count_convert_file_limit',
  'count_expend_2_file_limit',
  'count_error_collect_limit',
  'count_text_2_word_limit',
] as const;

export type TUserCountLimitField = (typeof USER_COUNT_LIMIT_FIELDS)[number];

/**
 * 时间限制类型：limit_type = time_date 时，使用 limit_date 记录过期时间
 */
export const USER_TIME_DATE_LIMIT_TYPE = 'time_date';

/**
 * /api/file/upload/:action 中 action 对应的次数限制字段
 */
export const FILE_UPLOAD_ACTION_COUNT_LIMIT: Record<
  string,
  TUserCountLimitField
> = {
  clear_hands_write: 'count_clear_hands_write_limit',
  convert_file: 'count_convert_file_limit',
};

export const FILE_EXPEND_2_FILE_COUNT_LIMIT: TUserCountLimitField =
  'count_expend_2_file_limit';

export const FILE_ERROR_COLLECT_COUNT_LIMIT: TUserCountLimitField =
  'count_error_collect_limit';

export const FILE_TEXT_2_WORD_COUNT_LIMIT: TUserCountLimitField =
  'count_text_2_word_limit';

/**
 * ai_subject_store 出题结果的保存时长：24 小时。
 * 由 AiSubjectStoreTask 每小时清理一次过期数据。
 */
export const AI_SUBJECT_STORE_TTL = 24 * 60 * 60 * 1000;
