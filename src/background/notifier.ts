/**
 * Thông báo mail mới, xử lý nút "Đã đọc"/"Archive", click mở side panel, và badge.
 * Firefox chỉ hỗ trợ type/title/message/iconUrl: không có nút, không có contextMessage —
 * tài khoản nhận được ghi vào nội dung thông báo; thao tác thực hiện trong sidebar.
 */
import { displayName } from '../lib/address';
import { batchModify } from '../lib/gmail-client';
import { getLocal, getSession, setSession, updateSession, type Account, type NotifTarget } from '../lib/storage';
import { ext, IS_FIREFOX } from '../lib/ext';

const ICON = ext.runtime.getURL('icons/128.png');
const GROUP_THRESHOLD = 3;

export interface MailSummary {
  id: string;
  from: string;
  subject: string;
}

async function createNotification(options: chrome.notifications.NotificationCreateOptions, target: NotifTarget): Promise<void> {
  const id = `${target.kind}:${crypto.randomUUID()}`;
  await updateSession('notifMap', (m) => ({ ...m, [id]: target }));
  await ext.notifications.create(id, IS_FIREFOX ? firefoxOptions(options) : options);
}

function firefoxOptions(o: chrome.notifications.NotificationCreateOptions): chrome.notifications.NotificationCreateOptions {
  return {
    type: 'basic',
    iconUrl: o.iconUrl,
    title: o.title,
    message: o.contextMessage ? `${o.message}\n${o.contextMessage}` : o.message,
  };
}

/** Tạo thông báo cho mail mới. >3 mail trong một lần -> gộp thành một thông báo. */
export async function notifyNewMail(account: Account, mails: MailSummary[], total = mails.length): Promise<void> {
  if (!mails.length) return;
  const buttons = [{ title: 'Đã đọc' }, { title: 'Archive' }];
  if (total > GROUP_THRESHOLD) {
    const lines = mails.slice(0, 4).map((m) => `${displayName(m.from)}: ${m.subject || '(không tiêu đề)'}`);
    await createNotification(
      {
        type: 'basic',
        iconUrl: ICON,
        title: `${total} thư mới — ${account.email}`,
        message: lines.join('\n') + (total > lines.length ? `\n…và ${total - lines.length} thư khác` : ''),
        contextMessage: `Tài khoản: ${account.email}`,
        buttons,
        priority: 1,
      },
      { kind: 'mail', accountId: account.id, messageIds: mails.map((m) => m.id) },
    );
    return;
  }
  for (const m of mails) {
    await createNotification(
      {
        type: 'basic',
        iconUrl: ICON,
        title: displayName(m.from) || '(không rõ người gửi)',
        message: m.subject || '(không tiêu đề)',
        contextMessage: `Tới: ${account.email}`,
        buttons,
        priority: 1,
      },
      { kind: 'mail', accountId: account.id, messageIds: [m.id] },
    );
  }
}

export async function notifyEvent(
  accountId: string,
  title: string,
  message: string,
  context: string,
  meetUrl?: string,
  htmlLink?: string,
): Promise<void> {
  await createNotification(
    {
      type: 'basic',
      iconUrl: ICON,
      title,
      message,
      contextMessage: context,
      buttons: meetUrl ? [{ title: 'Mở Google Meet' }] : [],
      requireInteraction: true,
      priority: 2,
    },
    { kind: 'event', accountId, meetUrl, htmlLink },
  );
}

async function takeTarget(id: string): Promise<NotifTarget | undefined> {
  const map = await getSession('notifMap');
  const t = map[id];
  if (t) {
    const { [id]: _x, ...rest } = map;
    await setSession('notifMap', rest);
  }
  return t;
}

/** Mở popup và yêu cầu nó hiển thị message (qua storage.session.pendingOpen). */
async function openMessage(accountId: string, messageId: string): Promise<void> {
  await setSession('pendingOpen', { accountId, messageId, at: Date.now() });
  try {
    // Chrome 127+ mở được popup từ background. Firefox chỉ cho mở khi có thao tác người dùng
    // (click thông báo không tính) -> ném lỗi -> mở thư trong tab.
    await ext.action.openPopup();
  } catch {
    await ext.tabs.create({ url: ext.runtime.getURL('popup/index.html?tab=1') });
  }
}

export function registerNotificationHandlers(onChanged: () => void): void {
  ext.notifications.onButtonClicked?.addListener((id, index) => {
    void (async () => {
      const t = await takeTarget(id);
      await ext.notifications.clear(id);
      if (!t) return;
      if (t.kind === 'mail' && t.messageIds?.length) {
        // 0 = Đã đọc, 1 = Archive (bỏ label INBOX)
        if (index === 0) await batchModify(t.accountId, t.messageIds, [], ['UNREAD']);
        else await batchModify(t.accountId, t.messageIds, [], ['INBOX']);
        onChanged();
      } else if (t.kind === 'event' && t.meetUrl) {
        await ext.tabs.create({ url: t.meetUrl });
      }
    })().catch((e) => console.warn('[notifier]', e));
  });

  ext.notifications.onClicked.addListener((id) => {
    void (async () => {
      const t = await takeTarget(id);
      await ext.notifications.clear(id);
      if (!t) return;
      if (t.kind === 'mail' && t.messageIds?.[0]) await openMessage(t.accountId, t.messageIds[0]);
      // Firefox không có nút "Mở Google Meet" -> click mở Meet nếu có.
      else if (t.kind === 'event' && IS_FIREFOX && t.meetUrl) await ext.tabs.create({ url: t.meetUrl });
      else if (t.kind === 'event' && t.htmlLink) await ext.tabs.create({ url: t.htmlLink });
    })().catch((e) => console.warn('[notifier]', e));
  });

  ext.notifications.onClosed.addListener((id) => {
    void takeTarget(id);
  });
}

/** Màu badge kiểu YouTube: nền đỏ, chữ trắng. */
const BADGE_BG = '#e62117';
const BADGE_FG = '#ffffff';

/** Số hiển thị trên icon: 1–99, quá 99 thì "99+". */
export function badgeText(total: number): string {
  if (total <= 0) return '';
  return total > 99 ? '99+' : String(total);
}

/** Badge: tổng unread INBOX của mọi tài khoản; "!" nếu có tài khoản cần đăng nhập lại. */
export async function updateBadge(): Promise<void> {
  const [accounts, unread] = await Promise.all([getLocal('accounts'), getSession('unread')]);
  await ext.action.setBadgeBackgroundColor({ color: BADGE_BG });
  await ext.action.setBadgeTextColor?.({ color: BADGE_FG });
  if (accounts.some((a) => a.needsReauth)) {
    await ext.action.setBadgeText({ text: '!' });
    await ext.action.setTitle({ title: 'Mail Pulse — có tài khoản cần đăng nhập lại' });
    return;
  }
  const total = accounts.reduce((sum, a) => sum + (unread[a.id] ?? 0), 0);
  await ext.action.setBadgeText({ text: badgeText(total) });
  await ext.action.setTitle({ title: total ? `Mail Pulse — ${total} thư chưa đọc` : 'Mail Pulse' });
}
