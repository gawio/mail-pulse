/**
 * Service worker của Mail Pulse. Mọi listener được đăng ký đồng bộ ở top-level (yêu cầu của MV3).
 */
import { onStorageChange, type Settings } from '../lib/storage';
import { registerDraftPort } from '../compose/draft-port';
import type { RuntimeMessage } from '../shared/messages';
import { CALENDAR_SYNC_ALARM, ensureAlarms, POLL_ALARM } from './alarms';
import { fireReminder, isReminderAlarm, syncCalendarReminders } from './calendar-reminder';
import { registerNotificationHandlers, updateBadge } from './notifier';
import { ensurePollLoop, pollSoon, refreshBadge, runPollLoop } from './poller';
import { ext } from '../lib/ext';

async function startup(): Promise<void> {
  await ensureAlarms();
  await Promise.all([runPollLoop(), syncCalendarReminders()]);
}

// Background có thể bị trình duyệt tắt rồi đánh thức lại bởi bất kỳ sự kiện nào — nối lại vòng lặp poll.
void ensurePollLoop();

ext.runtime.onInstalled.addListener(() => void startup());

ext.runtime.onStartup.addListener(() => void startup());

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) void ensurePollLoop();
  else if (alarm.name === CALENDAR_SYNC_ALARM) void syncCalendarReminders();
  else if (isReminderAlarm(alarm.name)) void fireReminder(alarm.name);
});

registerNotificationHandlers(() => void refreshBadge());
registerDraftPort();

// Quay lại trình duyệt -> cập nhật số trên icon ngay.
ext.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== ext.windows.WINDOW_ID_NONE) void pollSoon();
});

ext.storage.onChanged.addListener((changes, area) => {
  const c = changes.settings;
  if (area !== 'local' || !c) return;
  const before = c.oldValue as Settings | undefined;
  const after = c.newValue as Settings | undefined;
  if (before?.reminderMinutes !== after?.reminderMinutes) void syncCalendarReminders();
  if (before?.pollIntervalSec !== after?.pollIntervalSec) void runPollLoop();
});
onStorageChange('local', 'accounts', () => void updateBadge());

ext.runtime.onMessage.addListener((msg: RuntimeMessage, sender, sendResponse) => {
  // Chỉ nhận message từ chính extension.
  if (sender.id !== ext.runtime.id) return false;
  const done = (p: Promise<unknown>) => {
    p.then(
      () => sendResponse({ ok: true }),
      (e: unknown) => sendResponse({ ok: false, error: String(e) }),
    );
    return true;
  };
  switch (msg.type) {
    case 'poll-now':
      return done(runPollLoop());
    case 'refresh-badge':
      return done(refreshBadge());
    case 'calendar-sync':
      return done(syncCalendarReminders());
    case 'open-settings':
      return done(ext.runtime.openOptionsPage());
    default:
      return false;
  }
});
