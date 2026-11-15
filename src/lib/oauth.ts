/**
 * Phần thuần (không dùng API trình duyệt) của OAuth authorization code flow + PKCE:
 * dựng URL, đọc redirect, đọc phản hồi token, phân loại lỗi. Tách riêng để test được trong Node.
 */

export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** Base64url không padding (RFC 7636). */
export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

/** Sinh code_verifier ngẫu nhiên (43 ký tự) và code_challenge = BASE64URL(SHA256(verifier)). */
export async function createPkce(): Promise<Pkce> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  return { verifier, challenge: await pkceChallenge(verifier) };
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export interface AuthUrlParams {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  challenge: string;
  prompt?: string;
  loginHint?: string;
}

export function buildAuthUrl(p: AuthUrlParams): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', p.redirectUri);
  url.searchParams.set('scope', p.scopes.join(' '));
  url.searchParams.set('state', p.state);
  url.searchParams.set('code_challenge', p.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // offline -> Google trả refresh_token khi đổi code.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  if (p.prompt) url.searchParams.set('prompt', p.prompt);
  if (p.loginHint) url.searchParams.set('login_hint', p.loginHint);
  return url.toString();
}

/** Đọc `code` từ URL redirect (query; phòng hờ cả fragment). Ném lỗi nếu Google trả error hoặc state sai. */
export function parseAuthRedirect(redirect: string, expectedState: string): string {
  const u = new URL(redirect);
  const params = u.search.length > 1 ? u.searchParams : new URLSearchParams(u.hash.slice(1));
  const err = params.get('error');
  if (err) throw new Error(`OAuth lỗi: ${err}`);
  if (params.get('state') !== expectedState) throw new Error('OAuth state không khớp.');
  const code = params.get('code');
  if (!code) throw new Error('Không nhận được mã xác thực (code).');
  return code;
}

export interface TokenResponse {
  accessToken: string;
  /** epoch ms */
  expiresAt: number;
  refreshToken?: string;
  scopes: Set<string>;
}

interface RawTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export function parseTokenResponse(raw: RawTokenResponse, now = Date.now()): TokenResponse {
  const expiresIn = Number(raw.expires_in ?? 0);
  if (!raw.access_token || !expiresIn) throw new Error('Thiếu access_token.');
  return {
    accessToken: raw.access_token,
    expiresAt: now + expiresIn * 1000,
    ...(raw.refresh_token ? { refreshToken: raw.refresh_token } : {}),
    scopes: new Set((raw.scope ?? '').split(' ').filter(Boolean)),
  };
}

/**
 * Lỗi từ token endpoint có buộc người dùng đăng nhập lại không.
 * `invalid_grant`: refresh token bị thu hồi / hết hạn (app ở trạng thái Testing: 7 ngày) / đổi mật khẩu.
 * Các lỗi khác (5xx, mạng, invalid_client do cấu hình sai…) không sửa được bằng đăng nhập lại -> coi là tạm thời.
 */
export function refreshErrorNeedsReauth(status: number, error: string | undefined): boolean {
  return (status === 400 || status === 401) && error === 'invalid_grant';
}
