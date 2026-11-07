import { buildUserOssPath } from '../../src/service/utils/file';

describe('buildUserOssPath', () => {
  it('prefixes every user artifact with pub/<openid>/', () => {
    expect(
      buildUserOssPath('1731827391738912', '1731827391738912_plan.pdf')
    ).toBe('pub/1731827391738912/1731827391738912_plan.pdf');
  });

  it('sanitizes path traversal in openid and filename', () => {
    expect(buildUserOssPath('../user/openid', '../../secret.pdf')).toBe(
      'pub/___user_openid/secret.pdf'
    );
  });

  it('requires both user id and filename', () => {
    expect(() => buildUserOssPath('', 'file.pdf')).toThrow(
      'userId and fileName are required'
    );
    expect(() => buildUserOssPath('openid', '')).toThrow(
      'userId and fileName are required'
    );
  });
});
