/**
 * Lớp truy cập storage có kiểu.
 *
 * storage.local (bền vững) CHỈ chứa: danh sách tài khoản, refresh token OAuth, historyId, messageId đã thông báo,
 * templates, settings. KHÔNG bao giờ lưu nội dung mail ở đây.
 *
 * storage.session (chỉ trong RAM, mất khi đóng trình duyệt): access token OAuth, trạng thái backoff,
 * số unread cho badge, ánh xạ notification -> message, địa chỉ email đã thấy (gợi ý người nhận).
 */
import { ext } from './ext';
import { DEFAULT_TEMPLATES } from './default-templates';

export interface Account {
  /** Google account `sub` — ổn định, dùng làm accountId. */
  id: string;
  email: string;
  name: string;
  picture: string;
  /** Màu nhận diện tài khoản (lịch, chấm màu trong inbox gộp). */
  color: string;
  /** Bật/tắt thông báo mail mới cho tài khoản này. */
  notify: boolean;
  /** Refresh token bị Google từ chối (thu hồi/hết hạn) -> cần người dùng đăng nhập lại. */
  needsReauth: boolean;
}

export type ThemeMode = 'light' | 'dark' | 'system';
export type PollSeconds = 5 | 10 | 15 | 30 | 60 | 300;

export interface Settings {
  /** Chu kỳ kiểm tra thư mới (giây). */
  pollIntervalSec: PollSeconds;
  /** Popup thông báo của trình duyệt khi có thư mới (mặc định tắt — chỉ hiện số trên icon). */
  mailNotifications: boolean;
  skipPromotions: boolean;
  skipSocial: boolean;
  /** Nhắc trước sự kiện bao nhiêu phút (0 = tắt). */
  reminderMinutes: number;
  theme: ThemeMode;
  accent: string;
}

export interface Template {
  id: string;
  name: string;
  subject: string;
  /** HTML đơn giản (đã lọc theo whitelist khi chèn). */
  body: string;
  accountId?: string;
}

export interface TokenInfo {
  token: string;
  /** epoch ms */
  expiresAt: number;
}

export interface BackoffState {
  attempt: number;
  until: number;
}

export interface NotifTarget {
  kind: 'mail' | 'event';
  accountId: string;
  messageIds?: string[];
  meetUrl?: string;
  htmlLink?: string;
}

export interface PendingOpen {
  accountId: string;
  messageId: string;
  at: number;
}

export const DEFAULT_SETTINGS: Settings = {
  pollIntervalSec: 10,
  mailNotifications: false,
  skipPromotions: true,
  skipSocial: true,
  reminderMinutes: 10,
  theme: 'system',
  accent: '#3b6fe0',
};

export interface LocalSchema {
  accounts: Account[];
  /** Refresh token OAuth theo accountId — để lấy access token mới mà không cần đăng nhập lại. */
  refreshTokens: Record<string, string>;
  historyIds: Record<string, string>;
  notified: Record<string, string[]>;
  templates: Template[];
  settings: Settings;
}

export interface SessionSchema {
  tokens: Record<string, TokenInfo>;
  backoff: Record<string, BackoffState>;
  unread: Record<string, number>;
  notifMap: Record<string, NotifTarget>;
  seenAddresses: string[];
  pendingOpen: PendingOpen | null;
  /** Tên alarm nhắc sự kiện đã báo (tránh báo lặp). */
  remindedEvents: string[];
  /** Thời điểm poll gần nhất (epoch ms) — để vòng lặp poll nối lại đúng nhịp sau khi background bị tắt. */
  lastPollAt: number;
}

const LOCAL_DEFAULTS: LocalSchema = {
  accounts: [],
  refreshTokens: {},
  historyIds: {},
  notified: {},
  templates: DEFAULT_TEMPLATES,
  settings: DEFAULT_SETTINGS,
};

const SESSION_DEFAULTS: SessionSchema = {
  tokens: {},
  backoff: {},
  unread: {},
  notifMap: {},
  seenAddresses: [],
  pendingOpen: null,
  remindedEvents: [],
  lastPollAt: 0,
};

export type LocalKey = keyof LocalSchema;
export type SessionKey = keyof SessionSchema;

export async function getLocal<K extends LocalKey>(key: K): Promise<LocalSchema[K]> {
  const res = await ext.storage.local.get(key);
  const v = res[key] as LocalSchema[K] | undefined;
  if (key === 'settings') return { ...DEFAULT_SETTINGS, ...(v as Settings | undefined) } as LocalSchema[K];
  return v ?? structuredClone(LOCAL_DEFAULTS[key]);
}

export async function setLocal<K extends LocalKey>(key: K, value: LocalSchema[K]): Promise<void> {
  await ext.storage.local.set({ [key]: value });
}

export async function getSession<K extends SessionKey>(key: K): Promise<SessionSchema[K]> {
  const res = await ext.storage.session.get(key);
  return (res[key] as SessionSchema[K] | undefined) ?? structuredClone(SESSION_DEFAULTS[key]);
}

export async function setSession<K extends SessionKey>(key: K, value: SessionSchema[K]): Promise<void> {
  await ext.storage.session.set({ [key]: value });
}

/**
 * Read-modify-write tuần tự hoá trong cùng một context (tránh ghi đè lẫn nhau giữa các lời gọi song song).
 */
const queues = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(key, next.catch(() => undefined));
  return next;
}

export function updateLocal<K extends LocalKey>(key: K, fn: (v: LocalSchema[K]) => LocalSchema[K]): Promise<LocalSchema[K]> {
  return serialize(`local:${key}`, async () => {
    const next = fn(await getLocal(key));
    await setLocal(key, next);
    return next;
  });
}

export function updateSession<K extends SessionKey>(key: K, fn: (v: SessionSchema[K]) => SessionSchema[K]): Promise<SessionSchema[K]> {
  return serialize(`session:${key}`, async () => {
    const next = fn(await getSession(key));
    await setSession(key, next);
    return next;
  });
}

/** Đăng ký lắng nghe thay đổi một key; trả về hàm huỷ. */
export function onStorageChange<K extends LocalKey>(area: 'local', key: K, cb: (v: LocalSchema[K]) => void): () => void;
export function onStorageChange<K extends SessionKey>(area: 'session', key: K, cb: (v: SessionSchema[K]) => void): () => void;
export function onStorageChange(area: 'local' | 'session', key: string, cb: (v: never) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, a: string) => {
    if (a !== area || !(key in changes)) return;
    const getter = area === 'local' ? getLocal(key as LocalKey) : getSession(key as SessionKey);
    void getter.then((v) => cb(v as never));
  };
  ext.storage.onChanged.addListener(listener);
  return () => ext.storage.onChanged.removeListener(listener);
}

export async function getAccount(accountId: string): Promise<Account | undefined> {
  return (await getLocal('accounts')).find((a) => a.id === accountId);
}

export async function patchAccount(accountId: string, patch: Partial<Account>): Promise<void> {
  await updateLocal('accounts', (list) => list.map((a) => (a.id === accountId ? { ...a, ...patch } : a)));
}

export const ACCOUNT_COLORS = ['#3b6fe0', '#d9480f', '#2b8a3e', '#ae3ec9', '#e8590c', '#0c8599', '#c2255c', '#5f3dc4'];

export const MAX_NOTIFIED_PER_ACCOUNT = 200;

/** Ghi nhận messageId đã thông báo, giữ tối đa 200/tài khoản (bỏ cái cũ nhất). */
export async function addNotified(accountId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await updateLocal('notified', (all) => {
    const cur = all[accountId] ?? [];
    const merged = [...cur.filter((id) => !ids.includes(id)), ...ids];
    return { ...all, [accountId]: merged.slice(-MAX_NOTIFIED_PER_ACCOUNT) };
  });
}

export async function rememberAddresses(addrs: string[]): Promise<void> {
  const clean = addrs.map((a) => a.trim()).filter(Boolean);
  if (!clean.length) return;
  await updateSession('seenAddresses', (cur) => {
    const set = new Set(cur);
    for (const a of clean) set.add(a);
    return [...set].slice(-500);
  });
}
