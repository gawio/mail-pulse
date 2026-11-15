/**
 * Nhắc sự kiện: đồng bộ danh sách sự kiện mỗi 5 phút, đặt ext.alarms một lần cho từng sự kiện.
 * Tên alarm chỉ chứa ID (không chứa tiêu đề) — chi tiết được lấy lại khi alarm kích hoạt.
 */
import { isReauthError } from '../lib/auth';
import { eventStart, getEvent, isAllDay, listCalendars, listEvents, meetLink, selfDeclined } from '../lib/calendar-client';
import { getAccount, getLocal, getSession, updateSession } from '../lib/storage';
import { notifyEvent } from './notifier';
import { ext } from '../lib/ext';

const PREFIX = 'remind|';
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const MAX_REMINDED = 300;

interface ReminderKey {
  accountId: string;
  calendarId: string;
  eventId: string;
  startMs: number;
}

const encodeName = (k: ReminderKey) => `${PREFIX}${k.accountId}|${encodeURIComponent(k.calendarId)}|${encodeURIComponent(k.eventId)}|${k.startMs}`;

function decodeName(name: string): ReminderKey | null {
  if (!name.startsWith(PREFIX)) return null;
  const [accountId, cal, ev, start] = name.slice(PREFIX.length).split('|');
  if (!accountId || !cal || !ev || !start) return null;
  return { accountId, calendarId: decodeURIComponent(cal), eventId: decodeURIComponent(ev), startMs: Number(start) };
}

export const isReminderAlarm = (name: string) => name.startsWith(PREFIX);

async function alreadyReminded(name: string): Promise<boolean> {
  return (await getSession('remindedEvents')).includes(name);
}

async function markReminded(name: string): Promise<void> {
  await updateSession('remindedEvents', (l) => [...l.filter((x) => x !== name), name].slice(-MAX_REMINDED));
}

let syncing: Promise<void> | null = null;

export function syncCalendarReminders(): Promise<void> {
  syncing ??= doSync().finally(() => {
    syncing = null;
  });
  return syncing;
}

async function doSync(): Promise<void> {
  const [settings, accounts] = await Promise.all([getLocal('settings'), getLocal('accounts')]);
  const existing = (await ext.alarms.getAll()).filter((a) => isReminderAlarm(a.name));
  const leadMs = settings.reminderMinutes * 60_000;
  if (settings.reminderMinutes <= 0) {
    await Promise.all(existing.map((a) => ext.alarms.clear(a.name)));
    return;
  }
  const now = Date.now();
  const wanted = new Map<string, number>();
  const failedAccounts = new Set<string>();
  for (const account of accounts.filter((a) => !a.needsReauth)) {
    try {
      const calendars = await listCalendars(account.id, account.email);
      for (const cal of calendars) {
        const events = await listEvents(account.id, cal.id, new Date(now), new Date(now + LOOKAHEAD_MS + leadMs));
        for (const ev of events) {
          if (isAllDay(ev) || selfDeclined(ev)) continue;
          const startMs = eventStart(ev).getTime();
          if (startMs <= now) continue;
          const name = encodeName({ accountId: account.id, calendarId: cal.id, eventId: ev.id, startMs });
          wanted.set(name, Math.max(startMs - leadMs, now + 1000));
        }
      }
    } catch (e) {
      failedAccounts.add(account.id);
      if (!isReauthError(e)) console.warn(`[calendar] ${account.email}:`, e);
    }
  }
  // Xoá alarm của sự kiện đã đổi giờ/bị huỷ (giữ nguyên alarm của tài khoản lỗi tạm thời).
  for (const a of existing) {
    const k = decodeName(a.name);
    if (!wanted.has(a.name) && !(k && failedAccounts.has(k.accountId))) await ext.alarms.clear(a.name);
  }
  const existingNames = new Set(existing.map((a) => a.name));
  for (const [name, when] of wanted) {
    if (existingNames.has(name) || (await alreadyReminded(name))) continue;
    await ext.alarms.create(name, { when });
  }
}

export async function fireReminder(alarmName: string): Promise<void> {
  const k = decodeName(alarmName);
  if (!k || (await alreadyReminded(alarmName))) return;
  await markReminded(alarmName);
  const account = await getAccount(k.accountId);
  if (!account) return;
  try {
    const ev = await getEvent(k.accountId, k.calendarId, k.eventId);
    if (ev.status === 'cancelled' || selfDeclined(ev)) return;
    const start = eventStart(ev);
    if (start.getTime() !== k.startMs) return; // đã đổi giờ — lần sync sau sẽ đặt lại
    const mins = Math.max(0, Math.round((start.getTime() - Date.now()) / 60_000));
    const time = start.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    await notifyEvent(
      account.id,
      ev.summary || '(Không tiêu đề)',
      mins > 0 ? `Bắt đầu lúc ${time} (còn ${mins} phút)` : `Bắt đầu lúc ${time}`,
      [ev.location, account.email].filter(Boolean).join(' · '),
      meetLink(ev),
      ev.htmlLink,
    );
  } catch (e) {
    console.warn('[calendar] nhắc sự kiện lỗi:', e);
  }
}
