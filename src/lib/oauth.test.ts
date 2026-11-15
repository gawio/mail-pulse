import { describe, expect, it } from 'vitest';
import { buildAuthUrl, createPkce, parseAuthRedirect, parseTokenResponse, pkceChallenge, refreshErrorNeedsReauth } from './oauth';

describe('PKCE', () => {
  it('khớp vector mẫu của RFC 7636', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('verifier đủ dài và chỉ gồm ký tự hợp lệ', async () => {
    const { verifier, challenge } = await createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(await pkceChallenge(verifier));
  });
});

describe('buildAuthUrl', () => {
  it('xin code + offline + PKCE S256', () => {
    const u = new URL(
      buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1/mozoauth2/abc', scopes: ['a', 'b'], state: 's', challenge: 'c', loginHint: 'x@y.z' }),
    );
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBe('c');
    expect(u.searchParams.get('scope')).toBe('a b');
    expect(u.searchParams.get('login_hint')).toBe('x@y.z');
    expect(u.searchParams.has('prompt')).toBe(false);
  });
});

describe('parseAuthRedirect', () => {
  it('đọc code từ query', () => {
    expect(parseAuthRedirect('http://127.0.0.1/mozoauth2/abc?state=s&code=4%2Fxyz&scope=a', 's')).toBe('4/xyz');
  });
  it('báo lỗi khi state sai', () => {
    expect(() => parseAuthRedirect('http://127.0.0.1/x?state=bad&code=1', 's')).toThrow(/state/);
  });
  it('báo lỗi Google trả về', () => {
    expect(() => parseAuthRedirect('http://127.0.0.1/x?error=access_denied&state=s', 's')).toThrow(/access_denied/);
  });
});

describe('parseTokenResponse', () => {
  it('tính thời điểm hết hạn và giữ refresh token', () => {
    const r = parseTokenResponse({ access_token: 'at', expires_in: 3599, refresh_token: 'rt', scope: 'a b' }, 1000);
    expect(r).toEqual({ accessToken: 'at', expiresAt: 1000 + 3599_000, refreshToken: 'rt', scopes: new Set(['a', 'b']) });
  });
  it('thiếu access_token thì báo lỗi', () => {
    expect(() => parseTokenResponse({ expires_in: 10 })).toThrow();
  });
});

describe('refreshErrorNeedsReauth', () => {
  it('chỉ invalid_grant mới cần đăng nhập lại', () => {
    expect(refreshErrorNeedsReauth(400, 'invalid_grant')).toBe(true);
    expect(refreshErrorNeedsReauth(401, 'invalid_client')).toBe(false);
    expect(refreshErrorNeedsReauth(500, undefined)).toBe(false);
    expect(refreshErrorNeedsReauth(0, undefined)).toBe(false);
  });
});
