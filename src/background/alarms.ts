/** Đăng ký chrome.alarms. */
import { ext } from '../lib/ext';

/**
 * Alarm "người gác" mỗi 30 giây (mức tối thiểu của Chrome): nếu trình duyệt đã tắt background,
 * alarm đánh thức nó và nối lại vòng lặp poll. Việc poll thật chạy bằng setTimeout (xem poller.ts).
 */
export const POLL_ALARM = 'poll';
const WATCHDOG_MINUTES = 0.5;
export const CALENDAR_SYNC_ALARM = 'calendar-sync';
export const CALENDAR_SYNC_MINUTES = 5;

async function ensure(name: string, periodInMinutes: number): Promise<void> {
  const existing = await ext.alarms.get(name);
  if (existing?.periodInMinutes === periodInMinutes) return;
  await ext.alarms.create(name, { periodInMinutes, delayInMinutes: periodInMinutes });
}

export async function ensureAlarms(): Promise<void> {
  await ensure(POLL_ALARM, WATCHDOG_MINUTES);
  await ensure(CALENDAR_SYNC_ALARM, CALENDAR_SYNC_MINUTES);
}
