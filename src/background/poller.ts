/**
 * Poller: lặp qua từng tài khoản, dùng history.list để phát hiện mail mới trong INBOX.
 * Lần đầu chỉ lấy historyId (không báo mail cũ). 404 -> reset historyId.
 *
 * Nhịp poll: vòng lặp setTimeout theo settings.pollIntervalSec (mặc định 10 giây) — nhanh hơn
 * mức tối thiểu 30 giây của chrome.alarms. Mỗi lần chỉ tốn 1 request history.list/tài khoản;
 * số unread (labels.get) chỉ tải lại khi historyId của hộp thư thay đổi.
 */
import { AuthError } from '../lib/auth';
import { isBackedOff, recordFailure, recordSuccess } from '../lib/backoff';
import { getLabel, getMessage, getProfile, header, listHistory, type GmailMessage } from '../lib/gmail-client';
import { ApiError, mapLimit } from '../lib/http';
import { addNotified, getLocal, getSession, setSession, updateLocal, updateSession, type Account, type Settings } from '../lib/storage';
import { notifyNewMail, updateBadge, type MailSummary } from './notifier';

const MAX_HISTORY_PAGES = 10;
const MAX_METADATA_FETCH = 10;

async function setHistoryId(accountId: string, historyId: string): Promise<void> {
  await updateLocal('historyIds', (h) => ({ ...h, [accountId]: historyId }));
}

function isCandidate(m: GmailMessage, settings: Settings, notified: Set<string>): boolean {
  const labels = new Set(m.labelIds ?? []);
  if (!labels.has('INBOX') || !labels.has('UNREAD')) return false;
  if (notified.has(m.id)) return false;
  if (settings.skipPromotions && labels.has('CATEGORY_PROMOTIONS')) return false;
  if (settings.skipSocial && labels.has('CATEGORY_SOCIAL')) return false;
  return true;
}

async function pollAccount(account: Account, settings: Settings): Promise<void> {
  if (await isBackedOff(account.id)) return;
  try {
    const start = (await getLocal('historyIds'))[account.id];
    // Hộp thư có thay đổi gì không (thư mới, đã đọc ở nơi khác, archive…) — quyết định có tải lại số unread.
    let changed = true;
    if (!start) {
      await setHistoryId(account.id, (await getProfile(account.id)).historyId);
    } else {
      const added = new Map<string, GmailMessage>();
      let latest = start;
      let reset = false;
      try {
        let pageToken: string | undefined;
        let pages = 0;
        do {
          const r = await listHistory(account.id, start, pageToken);
          latest = r.historyId;
          for (const rec of r.history ?? []) for (const { message } of rec.messagesAdded ?? []) added.set(message.id, message);
          pageToken = r.nextPageToken;
        } while (pageToken && ++pages < MAX_HISTORY_PAGES);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
        // historyId quá cũ -> bắt đầu lại, không báo mail cũ.
        reset = true;
        latest = (await getProfile(account.id)).historyId;
      }

      changed = reset || latest !== start;

      if (!reset && added.size && settings.mailNotifications) {
        const notified = new Set((await getLocal('notified'))[account.id] ?? []);
        const candidates = [...added.values()].filter((m) => isCandidate(m, settings, notified));
        if (candidates.length) {
          if (account.notify) {
            const metas = await mapLimit(candidates.slice(0, MAX_METADATA_FETCH), 4, (m) =>
              getMessage(account.id, m.id, 'metadata', ['From', 'Subject']).catch(() => null),
            );
            // Kiểm tra lại nhãn hiện tại: có thể đã được đọc/chuyển đi trong lúc chờ.
            const mails: MailSummary[] = metas
              .filter((m): m is GmailMessage => !!m && isCandidate(m, settings, notified))
              .map((m) => ({ id: m.id, from: header(m, 'From'), subject: header(m, 'Subject') }));
            const total = candidates.length - (Math.min(candidates.length, MAX_METADATA_FETCH) - mails.length);
            await notifyNewMail(account, mails, total);
          }
          await addNotified(account.id, candidates.map((m) => m.id));
        }
      }
      if (latest !== start) await setHistoryId(account.id, latest);
    }
    const known = (await getSession('unread'))[account.id] !== undefined;
    if (changed || !known) await refreshUnread(account.id);
    await recordSuccess(account.id);
  } catch (e) {
    if ((e instanceof ApiError && e.retryable) || (e instanceof AuthError && e.transient)) {
      const s = await recordFailure(account.id);
      console.warn(`[poller] ${account.email}: ${e.message}; thử lại sau ${Math.round((s.until - Date.now()) / 1000)}s`);
    } else if (e instanceof AuthError) {
      // needsReauth đã được đánh dấu trong auth.ts — không spam thông báo.
    } else {
      console.warn(`[poller] ${account.email}:`, e);
    }
  }
}

export async function refreshUnread(accountId: string): Promise<void> {
  const inbox = await getLabel(accountId, 'INBOX');
  const n = inbox.messagesUnread ?? 0;
  // Chỉ ghi khi đổi — tránh làm side panel tải lại danh sách vô ích.
  if ((await getSession('unread'))[accountId] === n) return;
  await updateSession('unread', (u) => ({ ...u, [accountId]: n }));
}

let running: Promise<void> | null = null;

/** Poll mọi tài khoản (bỏ qua nếu đang chạy). */
export function pollAll(): Promise<void> {
  running ??= (async () => {
    try {
      await setSession('lastPollAt', Date.now());
      const [accounts, settings] = await Promise.all([getLocal('accounts'), getLocal('settings')]);
      await Promise.all(accounts.filter((a) => !a.needsReauth).map((a) => pollAccount(a, settings)));
    } finally {
      await updateBadge();
      running = null;
    }
  })();
  return running;
}

/** Chỉ cập nhật số unread + badge (sau khi người dùng đánh dấu đọc/archive). */
export async function refreshBadge(): Promise<void> {
  const accounts = await getLocal('accounts');
  await Promise.all(accounts.filter((a) => !a.needsReauth).map((a) => refreshUnread(a.id).catch(() => undefined)));
  await updateBadge();
}

// ---- Vòng lặp poll nhanh ----

let loopTimer: ReturnType<typeof setTimeout> | undefined;
let loopGen = 0;

/** Poll ngay rồi hẹn lần kế tiếp theo pollIntervalSec. Gọi lại sẽ khởi động lại nhịp. */
export async function runPollLoop(): Promise<void> {
  const gen = ++loopGen;
  clearTimeout(loopTimer);
  loopTimer = undefined;
  await pollAll();
  if (gen !== loopGen) return; // đã có lần chạy mới hơn
  const [settings, accounts] = await Promise.all([getLocal('settings'), getLocal('accounts')]);
  if (!accounts.some((a) => !a.needsReauth)) return; // không có gì để poll — alarm gác sẽ gọi lại sau
  // Lời gọi API extension (storage) mỗi nhịp giữ background sống khi nhịp ≤ 30 giây.
  loopTimer = setTimeout(() => void runPollLoop(), settings.pollIntervalSec * 1000);
}

/**
 * Bảo đảm vòng lặp đang chạy (gọi từ alarm gác, khi background thức dậy, khi cửa sổ được focus).
 * Nếu background vừa bị tắt rồi bật lại, poll ngay khi đã tới hạn, nếu chưa thì hẹn đúng lúc.
 */
export async function ensurePollLoop(): Promise<void> {
  if (loopTimer !== undefined || running) return;
  const [{ pollIntervalSec }, last] = await Promise.all([getLocal('settings'), getSession('lastPollAt')]);
  if (loopTimer !== undefined || running) return;
  const due = last + pollIntervalSec * 1000 - Date.now();
  if (due <= 0) void runPollLoop();
  else loopTimer = setTimeout(() => void runPollLoop(), due);
}

/** Người dùng quay lại trình duyệt: kiểm tra ngay (không quá 1 lần mỗi 3 giây). */
export async function pollSoon(): Promise<void> {
  if (running) return;
  const last = await getSession('lastPollAt');
  if (Date.now() - last > 3000) void runPollLoop();
}
