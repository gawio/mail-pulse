/**
 * fetch có xác thực theo accountId. Mọi API call của Gmail/Calendar đi qua đây.
 * Chỉ cho phép các origin trong whitelist (phòng thủ thêm ngoài CSP connect-src).
 */
import { getToken, invalidateToken } from './auth';

const ALLOWED = ['https://gmail.googleapis.com/', 'https://www.googleapis.com/', 'https://accounts.google.com/'];

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly accountId: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export type Query = Record<string, string | number | boolean | undefined | (string | number)[]>;

export function withQuery(base: string, q?: Query): string {
  if (!q) return base;
  const url = new URL(base);
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, String(item));
    else url.searchParams.set(k, String(v));
  }
  return url.toString();
}

export async function apiFetch(accountId: string, url: string, init: RequestInit = {}, retryAuth = true): Promise<Response> {
  if (!ALLOWED.some((o) => url.startsWith(o))) throw new Error(`Chặn request tới origin không cho phép: ${url}`);
  const token = await getToken(accountId);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  if (res.status === 401 && retryAuth) {
    await invalidateToken(accountId);
    return apiFetch(accountId, url, init, false);
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) msg = `${res.status}: ${body.error.message}`;
    } catch {
      /* body không phải JSON */
    }
    throw new ApiError(res.status, accountId, msg);
  }
  return res;
}

export async function apiJson<T>(accountId: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(accountId, url, init);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function jsonBody(body: unknown): RequestInit {
  return { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/** Chạy các tác vụ với giới hạn đồng thời. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}
