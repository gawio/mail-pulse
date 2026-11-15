/** Tải danh sách mail (một hoặc nhiều tài khoản) và các thao tác hàng loạt. Dữ liệu chỉ nằm trong bộ nhớ. */
import { parseAddressList } from '../lib/address';
import { isReauthError } from '../lib/auth';
import { batchModify, getMessage, header, listMessages, modifyMessage, trashMessage, untrashMessage } from '../lib/gmail-client';
import { mapLimit } from '../lib/http';
import { rememberAddresses, type Account } from '../lib/storage';
import { sendToBackground } from '../shared/messages';

export interface MailItem {
  key: string;
  accountId: string;
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: number;
  unread: boolean;
  labelIds: string[];
}

export interface PageState {
  /** accountId -> pageToken kế tiếp (undefined = hết) */
  tokens: Record<string, string | undefined>;
  started: boolean;
}

const PAGE_SIZE = 25;

function decodeEntities(s: string): string {
  // snippet của Gmail có HTML entities; giải mã an toàn qua DOMParser (không thực thi).
  return new DOMParser().parseFromString(`<!doctype html><body>${s}`, 'text/html').body.textContent ?? '';
}

async function loadAccountPage(accountId: string, q: string, pageToken: string | undefined) {
  const list = await listMessages(accountId, { q, labelIds: q ? undefined : ['INBOX'], pageToken, maxResults: PAGE_SIZE });
  const metas = await mapLimit(list.messages ?? [], 8, (m) =>
    getMessage(accountId, m.id, 'metadata', ['From', 'To', 'Cc', 'Subject', 'Date']).catch(() => null),
  );
  const seen: string[] = [];
  const items: MailItem[] = [];
  for (const m of metas) {
    if (!m) continue;
    for (const h of ['From', 'To', 'Cc']) seen.push(...parseAddressList(header(m, h)).map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)));
    items.push({
      key: `${accountId}:${m.id}`,
      accountId,
      id: m.id,
      threadId: m.threadId,
      from: header(m, 'From'),
      subject: header(m, 'Subject'),
      snippet: decodeEntities(m.snippet ?? ''),
      date: Number(m.internalDate ?? 0),
      unread: m.labelIds?.includes('UNREAD') ?? false,
      labelIds: m.labelIds ?? [],
    });
  }
  void rememberAddresses(seen);
  return { items, next: list.nextPageToken };
}

/** Tải trang kế tiếp cho các tài khoản đang xem; trả về item mới (đã sắp theo thời gian) và trạng thái trang. */
export async function loadNextPage(
  accounts: Account[],
  q: string,
  state: PageState,
): Promise<{ items: MailItem[]; state: PageState; errors: string[] }> {
  const targets = accounts.filter((a) => !a.needsReauth && (!state.started || state.tokens[a.id]));
  const errors: string[] = [];
  const tokens: Record<string, string | undefined> = { ...state.tokens };
  const results = await Promise.all(
    targets.map(async (a) => {
      try {
        const r = await loadAccountPage(a.id, q, state.started ? state.tokens[a.id] : undefined);
        tokens[a.id] = r.next;
        return r.items;
      } catch (e) {
        // Lỗi đăng nhập đã có banner "cần đăng nhập lại" ở trên — không lặp lại.
        if (!isReauthError(e)) errors.push(`${a.email}: ${e instanceof Error ? e.message : e}`);
        tokens[a.id] = undefined;
        return [];
      }
    }),
  );
  const items = results.flat().sort((x, y) => y.date - x.date);
  return { items, state: { tokens, started: true }, errors };
}

function groupByAccount(items: MailItem[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const it of items) map.set(it.accountId, [...(map.get(it.accountId) ?? []), it.id]);
  return map;
}

async function forEachAccount(items: MailItem[], fn: (accountId: string, ids: string[]) => Promise<unknown>): Promise<void> {
  await Promise.all([...groupByAccount(items)].map(([acc, ids]) => fn(acc, ids)));
  void sendToBackground({ type: 'refresh-badge' });
}

export const markRead = (items: MailItem[], read: boolean) =>
  forEachAccount(items, (acc, ids) => (read ? batchModify(acc, ids, [], ['UNREAD']) : batchModify(acc, ids, ['UNREAD'], [])));

export const archive = (items: MailItem[]) => forEachAccount(items, (acc, ids) => batchModify(acc, ids, [], ['INBOX']));

export const unarchive = (items: MailItem[]) => forEachAccount(items, (acc, ids) => batchModify(acc, ids, ['INBOX'], []));

/** messages.trash — chuyển vào Thùng rác, KHÔNG xoá vĩnh viễn. */
export const trash = (items: MailItem[]) => forEachAccount(items, (acc, ids) => mapLimit(ids, 5, (id) => trashMessage(acc, id)));

export const untrash = (items: MailItem[]) =>
  forEachAccount(items, (acc, ids) =>
    mapLimit(ids, 5, async (id) => {
      await untrashMessage(acc, id);
      // Đảm bảo thư quay lại Hộp thư đến.
      await modifyMessage(acc, id, ['INBOX'], []);
    }),
  );

export function formatTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('vi-VN', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('vi-VN');
}
