/**
 * 删除obj种值为null火鹤undefined的key
 * @param obj
 */
export const ObjectNonNull = (obj: { [key: string]: any }) => {
  Object.keys(obj).forEach(k => {
    if ([null, undefined].includes(obj[k])) {
      delete obj[k];
    }
  });
  return obj;
};
