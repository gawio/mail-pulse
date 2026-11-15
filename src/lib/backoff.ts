/** Exponential backoff theo tài khoản (lưu trong storage.session để sống sót khi service worker ngủ). */
import { getSession, updateSession, type BackoffState } from './storage';

export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 30 * 60_000;

/** Độ trễ cho lần thất bại thứ `attempt` (bắt đầu từ 1), có jitter ±20%. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const raw = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.round(Math.min(BACKOFF_MAX_MS, raw * jitter));
}

export function nextBackoff(prev: BackoffState | undefined, now: number, random?: () => number): BackoffState {
  const attempt = (prev?.attempt ?? 0) + 1;
  return { attempt, until: now + backoffDelay(attempt, random) };
}

export async function isBackedOff(accountId: string, now = Date.now()): Promise<boolean> {
  const s = (await getSession('backoff'))[accountId];
  return !!s && s.until > now;
}

export async function recordFailure(accountId: string): Promise<BackoffState> {
  let state!: BackoffState;
  await updateSession('backoff', (all) => {
    state = nextBackoff(all[accountId], Date.now());
    return { ...all, [accountId]: state };
  });
  return state;
}

export async function recordSuccess(accountId: string): Promise<void> {
  const all = await getSession('backoff');
  if (!(accountId in all)) return;
  await updateSession('backoff', (cur) => {
    const { [accountId]: _x, ...rest } = cur;
    return rest;
  });
}
