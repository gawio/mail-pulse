/**
 * OAuth 2.0 authorization code flow + PKCE qua ext.identity.launchWebAuthFlow (chỉ chạy khi người dùng bấm).
 * - Đổi code lấy access token (~1 giờ, storage.session) + refresh token (bền vững, storage.local).
 * - Hết hạn -> làm mới bằng refresh token qua fetch tới token endpoint: không cần cookie Google trong trình duyệt,
 *   không cần launchWebAuthFlow im lặng.
 * - Chỉ khi Google trả `invalid_grant` (quyền bị thu hồi/hết hạn) mới đánh dấu needsReauth. Lỗi mạng/5xx là tạm thời.
 *
 * Client loại "Web application" bắt buộc gửi client_secret khi đổi token, kể cả có PKCE. Secret này nằm trong bản build
 * extension (không thể giữ bí mật ở phía client) — chấp nhận được với app cá nhân; PKCE + redirect URI đã đăng ký
 * vẫn ngăn kẻ khác dùng code bị lộ.
 */
import {
  ACCOUNT_COLORS,
  getAccount,
  getLocal,
  getSession,
  patchAccount,
  updateLocal,
  updateSession,
  type Account,
  type TokenInfo,
} from './storage';
import { ext, IS_FIREFOX } from './ext';
import {
  buildAuthUrl,
  createPkce,
  parseAuthRedirect,
  parseTokenResponse,
  refreshErrorNeedsReauth,
  REVOKE_ENDPOINT,
  TOKEN_ENDPOINT,
  type TokenResponse,
} from './oauth';

export const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.events',
  // calendarList.list KHÔNG chấp nhận scope calendar.events; đây là scope tối thiểu (chỉ đọc danh sách lịch).
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const;

/** Scope bắt buộc phải được cấp (người dùng có thể bỏ tick ở màn hình consent chi tiết). */
const REQUIRED_SCOPES = SCOPES.filter((s) => s.startsWith('https://'));

const CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
const CLIENT_SECRET: string = import.meta.env.VITE_GOOGLE_CLIENT_SECRET ?? '';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
/** Làm mới sớm 2 phút trước khi hết hạn. */
const EXPIRY_SKEW_MS = 2 * 60 * 1000;

export class AuthError extends Error {
  constructor(
    public readonly accountId: string | null,
    message: string,
    /** true: lỗi tạm thời (mạng, 5xx) — sẽ tự thử lại, KHÔNG cần đăng nhập lại. */
    public readonly transient = false,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Lỗi "tài khoản cần đăng nhập lại" — giao diện đã hiển thị riêng, không cần báo thêm. */
export function isReauthError(e: unknown): boolean {
  return e instanceof AuthError && !e.transient;
}

interface FlowOptions {
  loginHint?: string;
  prompt?: string;
}

interface UserInfo {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

/**
 * Redirect URI dùng cho OAuth.
 * - Chrome: https://<extension-id>.chromiumapp.org/
 * - Firefox: Google không chấp nhận tên miền https://<mã>.extensions.allizom.org/ (chưa xác minh quyền sở hữu),
 *   nên dùng địa chỉ loopback mà Firefox (86+) hỗ trợ cho launchWebAuthFlow:
 *   http://127.0.0.1/mozoauth2/<mã>  — <mã> là subdomain của getRedirectURL().
 *   Không có request nào thật sự tới 127.0.0.1: Firefox chặn và đọc kết quả từ URL redirect.
 */
export function oauthRedirectUri(): string {
  const base = ext.identity.getRedirectURL();
  if (!IS_FIREFOX) return base;
  const sub = new URL(base).hostname.split('.')[0];
  return `http://127.0.0.1/mozoauth2/${sub}`;
}

function assertConfigured(): void {
  if (!CLIENT_ID) throw new AuthError(null, 'Chưa cấu hình VITE_GOOGLE_CLIENT_ID (xem README).');
  if (!CLIENT_SECRET) throw new AuthError(null, 'Chưa cấu hình VITE_GOOGLE_CLIENT_SECRET (xem README).');
}

/** POST tới token endpoint. Lỗi mạng -> AuthError tạm thời; lỗi HTTP -> trả status + mã lỗi để phân loại. */
async function postToken(
  accountId: string | null,
  body: Record<string, string>,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; error?: string; description?: string }> {
  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...body }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  } catch (e) {
    throw new AuthError(accountId, `Không kết nối được máy chủ Google (${e instanceof Error ? e.message : e}).`, true);
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* body không phải JSON */
  }
  if (res.ok) return { ok: true, data };
  return {
    ok: false,
    status: res.status,
    error: typeof data.error === 'string' ? data.error : undefined,
    description: typeof data.error_description === 'string' ? data.error_description : undefined,
  };
}

/** Đăng nhập tương tác: mở cửa sổ Google, đổi code lấy token. */
async function runFlow(opts: FlowOptions): Promise<TokenResponse> {
  assertConfigured();
  const state = crypto.randomUUID();
  const pkce = await createPkce();
  const redirectUri = oauthRedirectUri();
  const url = buildAuthUrl({
    clientId: CLIENT_ID,
    redirectUri,
    scopes: SCOPES,
    state,
    challenge: pkce.challenge,
    prompt: opts.prompt,
    loginHint: opts.loginHint,
  });

  let code: string;
  try {
    // Firefox chỉ nhận url + interactive (từ chối thuộc tính lạ); nó tự đọc redirect_uri trong URL.
    const redirect = await ext.identity.launchWebAuthFlow({ url, interactive: true });
    if (!redirect) throw new Error('Không nhận được phản hồi OAuth.');
    code = parseAuthRedirect(redirect, state);
  } catch (e) {
    throw new AuthError(null, e instanceof Error ? e.message : String(e));
  }

  const r = await postToken(null, {
    grant_type: 'authorization_code',
    code,
    code_verifier: pkce.verifier,
    redirect_uri: redirectUri,
  });
  if (!r.ok) throw new AuthError(null, `Đổi mã xác thực thất bại (${r.status} ${r.error ?? ''}${r.description ? `: ${r.description}` : ''}).`);
  let tok: TokenResponse;
  try {
    tok = parseTokenResponse(r.data);
  } catch (e) {
    throw new AuthError(null, e instanceof Error ? e.message : String(e));
  }

  const missing = REQUIRED_SCOPES.filter((s) => !tok.scopes.has(s));
  if (missing.length) {
    throw new AuthError(null, `Bạn chưa cấp đủ quyền: ${missing.map((s) => s.split('/').pop()).join(', ')}. Hãy thêm lại tài khoản và tick tất cả quyền.`);
  }
  return tok;
}

async function fetchUserInfo(token: string): Promise<UserInfo> {
  const res = await fetch(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new AuthError(null, `Không lấy được thông tin tài khoản (${res.status}).`);
  return (await res.json()) as UserInfo;
}

async function saveAccessToken(accountId: string, tok: TokenResponse): Promise<void> {
  const info: TokenInfo = { token: tok.accessToken, expiresAt: tok.expiresAt };
  await updateSession('tokens', (t) => ({ ...t, [accountId]: info }));
}

/**
 * Lưu token sau khi đăng nhập tương tác. Google chỉ trả refresh_token ở lần cấp quyền offline đầu tiên;
 * nếu lần này không có thì giữ refresh token cũ (nếu có), không có nữa thì báo cách khắc phục.
 */
async function saveTokensAfterLogin(accountId: string, email: string, tok: TokenResponse): Promise<void> {
  const refresh = tok.refreshToken ?? (await getLocal('refreshTokens'))[accountId];
  if (!refresh) {
    throw new AuthError(
      accountId,
      `Google không cấp quyền truy cập lâu dài (refresh token) cho ${email}. Vào myaccount.google.com/connections, ` +
        'gỡ quyền của Mail Pulse cho tài khoản này rồi đăng nhập lại.',
    );
  }
  await updateLocal('refreshTokens', (r) => ({ ...r, [accountId]: refresh }));
  await saveAccessToken(accountId, tok);
}

/** Thêm tài khoản mới (tương tác). Nếu tài khoản đã tồn tại thì cập nhật và xoá cờ needsReauth. */
export async function addAccount(): Promise<Account> {
  // KHÔNG dùng prompt=consent: với client Web application chưa xác minh, Google trả trang
  // "Đã xảy ra lỗi" (info/unknownerror) ngay sau màn cảnh báo. Google vẫn tự hiện màn consent
  // khi còn scope / quyền offline chưa được cấp; runFlow kiểm tra lại đủ scope.
  const tok = await runFlow({ prompt: 'select_account' });
  const info = await fetchUserInfo(tok.accessToken);
  await saveTokensAfterLogin(info.sub, info.email, tok);
  const accounts = await getLocal('accounts');
  const existing = accounts.find((a) => a.id === info.sub);
  const account: Account = {
    id: info.sub,
    email: info.email,
    name: info.name ?? info.email,
    picture: info.picture ?? '',
    color: existing?.color ?? ACCOUNT_COLORS[accounts.length % ACCOUNT_COLORS.length] ?? '#3b6fe0',
    notify: existing?.notify ?? true,
    needsReauth: false,
  };
  await updateLocal('accounts', (list) =>
    list.some((a) => a.id === account.id) ? list.map((a) => (a.id === account.id ? account : a)) : [...list, account],
  );
  return account;
}

const inflight = new Map<string, Promise<string>>();

/**
 * Lấy access token hợp lệ cho tài khoản. Hết hạn -> làm mới bằng refresh token.
 * - Google trả invalid_grant -> đánh dấu needsReauth, ném AuthError (không bật popup, không spam).
 * - Lỗi mạng/5xx -> ném AuthError transient (poller sẽ backoff rồi thử lại), KHÔNG đánh dấu needsReauth.
 */
export function getToken(accountId: string): Promise<string> {
  const pending = inflight.get(accountId);
  if (pending) return pending;
  const p = (async () => {
    const cached = (await getSession('tokens'))[accountId];
    if (cached && cached.expiresAt - EXPIRY_SKEW_MS > Date.now()) return cached.token;

    const account = await getAccount(accountId);
    if (!account) throw new AuthError(accountId, 'Tài khoản không tồn tại.');
    if (account.needsReauth) throw new AuthError(accountId, `${account.email} cần đăng nhập lại.`);
    assertConfigured();
    const refresh = (await getLocal('refreshTokens'))[accountId];
    if (!refresh) {
      // Tài khoản thêm từ bản cũ (implicit flow, không có refresh token): cần đăng nhập lại một lần.
      await markNeedsReauth(accountId);
      throw new AuthError(accountId, `${account.email} cần đăng nhập lại.`);
    }

    const r = await postToken(accountId, { grant_type: 'refresh_token', refresh_token: refresh });
    if (!r.ok) {
      if (refreshErrorNeedsReauth(r.status, r.error)) {
        await markNeedsReauth(accountId);
        throw new AuthError(accountId, `${account.email} cần đăng nhập lại (${r.error}).`);
      }
      throw new AuthError(accountId, `Làm mới token cho ${account.email} thất bại (${r.status} ${r.error ?? ''}).`, true);
    }
    let tok: TokenResponse;
    try {
      tok = parseTokenResponse(r.data);
    } catch (e) {
      throw new AuthError(accountId, e instanceof Error ? e.message : String(e), true);
    }
    // Google thường không xoay vòng refresh token, nhưng nếu có trả về token mới thì lưu lại.
    if (tok.refreshToken && tok.refreshToken !== refresh) {
      await updateLocal('refreshTokens', (all) => ({ ...all, [accountId]: tok.refreshToken as string }));
    }
    await saveAccessToken(accountId, tok);
    return tok.accessToken;
  })();
  inflight.set(accountId, p);
  void p.finally(() => inflight.delete(accountId)).catch(() => undefined);
  return p;
}

async function markNeedsReauth(accountId: string): Promise<void> {
  await patchAccount(accountId, { needsReauth: true });
  await updateLocal('refreshTokens', (r) => {
    const { [accountId]: _drop, ...rest } = r;
    return rest;
  });
  await invalidateToken(accountId);
}

/** Đăng nhập lại tương tác (người dùng bấm nút). */
export async function reauthInteractive(accountId: string): Promise<void> {
  const account = await getAccount(accountId);
  if (!account) throw new AuthError(accountId, 'Tài khoản không tồn tại.');
  const tok = await runFlow({ loginHint: account.email });
  const info = await fetchUserInfo(tok.accessToken);
  if (info.sub !== account.id) throw new AuthError(accountId, `Bạn đã đăng nhập ${info.email}, không phải ${account.email}.`);
  await saveTokensAfterLogin(accountId, account.email, tok);
  await patchAccount(accountId, {
    needsReauth: false,
    name: info.name ?? account.name,
    picture: info.picture ?? account.picture,
  });
}

/** Token bị server từ chối (401) -> bỏ access token cache để lần sau làm mới bằng refresh token. */
export async function invalidateToken(accountId: string): Promise<void> {
  await updateSession('tokens', (t) => {
    const { [accountId]: _drop, ...rest } = t;
    return rest;
  });
}

/** Xoá tài khoản: thu hồi quyền (best-effort) và xoá mọi dữ liệu liên quan trong storage. */
export async function removeAccount(accountId: string): Promise<void> {
  // Thu hồi refresh token = thu hồi cả lượt cấp quyền (kèm mọi access token). Không có thì thu hồi access token.
  const tok = (await getLocal('refreshTokens'))[accountId] ?? (await getSession('tokens'))[accountId]?.token;
  if (tok) {
    try {
      await fetch(REVOKE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: tok }),
        credentials: 'omit',
      });
    } catch {
      /* best-effort */
    }
  }
  const drop = <T,>(rec: Record<string, T>): Record<string, T> => {
    const { [accountId]: _x, ...rest } = rec;
    return rest;
  };
  await updateLocal('accounts', (l) => l.filter((a) => a.id !== accountId));
  await updateLocal('refreshTokens', drop);
  await updateLocal('historyIds', drop);
  await updateLocal('notified', drop);
  await updateLocal('templates', (l) => l.map((t) => (t.accountId === accountId ? { ...t, accountId: undefined } : t)));
  await updateSession('tokens', drop);
  await updateSession('backoff', drop);
  await updateSession('unread', drop);
}
