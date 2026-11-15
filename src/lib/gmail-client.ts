/** Gmail API v1 client. Mọi hàm nhận accountId đầu tiên. */
import { apiFetch, apiJson, jsonBody, withQuery } from './http';
import { toBase64Url } from './mime';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const UPLOAD = 'https://gmail.googleapis.com/upload/gmail/v1/users/me';

export interface Header {
  name: string;
  value: string;
}

export interface MessagePart {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: Header[];
  body?: { size: number; data?: string; attachmentId?: string };
  parts?: MessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  historyId?: string;
  sizeEstimate?: number;
  payload?: MessagePart;
}

export interface Profile {
  emailAddress: string;
  messagesTotal: number;
  historyId: string;
}

export interface HistoryRecord {
  id: string;
  messagesAdded?: { message: GmailMessage }[];
}

export interface HistoryList {
  history?: HistoryRecord[];
  historyId: string;
  nextPageToken?: string;
}

export interface MessageList {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface Label {
  id: string;
  name: string;
  messagesTotal?: number;
  messagesUnread?: number;
}

export interface Draft {
  id: string;
  message: GmailMessage;
}

export const getProfile = (acc: string) => apiJson<Profile>(acc, `${BASE}/profile`);

export const listHistory = (acc: string, startHistoryId: string, pageToken?: string) =>
  apiJson<HistoryList>(
    acc,
    withQuery(`${BASE}/history`, { startHistoryId, historyTypes: 'messageAdded', labelId: 'INBOX', pageToken, maxResults: 100 }),
  );

export const listMessages = (acc: string, opts: { q?: string; labelIds?: string[]; pageToken?: string; maxResults?: number }) =>
  apiJson<MessageList>(
    acc,
    withQuery(`${BASE}/messages`, { q: opts.q || undefined, labelIds: opts.labelIds, pageToken: opts.pageToken, maxResults: opts.maxResults ?? 25 }),
  );

export const getMessage = (acc: string, id: string, format: 'full' | 'metadata' | 'minimal', metadataHeaders?: string[]) =>
  apiJson<GmailMessage>(acc, withQuery(`${BASE}/messages/${encodeURIComponent(id)}`, { format, metadataHeaders }));

export const modifyMessage = (acc: string, id: string, add: string[], remove: string[]) =>
  apiJson<GmailMessage>(acc, `${BASE}/messages/${encodeURIComponent(id)}/modify`, {
    method: 'POST',
    ...jsonBody({ addLabelIds: add, removeLabelIds: remove }),
  });

export const batchModify = (acc: string, ids: string[], add: string[], remove: string[]) =>
  apiJson<void>(acc, `${BASE}/messages/batchModify`, { method: 'POST', ...jsonBody({ ids, addLabelIds: add, removeLabelIds: remove }) });

/** Chuyển vào Thùng rác (có thể khôi phục). KHÔNG có xoá vĩnh viễn. */
export const trashMessage = (acc: string, id: string) =>
  apiJson<GmailMessage>(acc, `${BASE}/messages/${encodeURIComponent(id)}/trash`, { method: 'POST' });

export const untrashMessage = (acc: string, id: string) =>
  apiJson<GmailMessage>(acc, `${BASE}/messages/${encodeURIComponent(id)}/untrash`, { method: 'POST' });

export const getLabel = (acc: string, id: string) => apiJson<Label>(acc, `${BASE}/labels/${encodeURIComponent(id)}`);

export const getAttachment = (acc: string, messageId: string, attachmentId: string) =>
  apiJson<{ size: number; data: string }>(
    acc,
    `${BASE}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );

/**
 * Upload multipart (metadata JSON + message/rfc822). Dùng endpoint /upload để gửi được tới 35MB
 * mà không phải base64 thêm một lần nữa.
 */
async function uploadRfc822<T>(acc: string, url: string, method: 'POST' | 'PUT', metadata: unknown, rawMime: string): Promise<T> {
  const boundary = `mp_${crypto.randomUUID().replace(/-/g, '')}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`,
    rawMime,
    `\r\n--${boundary}--`,
  ]);
  const res = await apiFetch(acc, withQuery(url, { uploadType: 'multipart' }), {
    method,
    body,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
  });
  return (await res.json()) as T;
}

/** Thư nhỏ: JSON { raw: base64url }. Thư lớn (đính kèm nhiều): endpoint upload (tới 35MB). */
const JSON_RAW_LIMIT = 3 * 1024 * 1024;

export const sendMessage = (acc: string, rawMime: string, threadId?: string) =>
  rawMime.length < JSON_RAW_LIMIT
    ? apiJson<GmailMessage>(acc, `${BASE}/messages/send`, { method: 'POST', ...jsonBody({ raw: toBase64Url(rawMime), threadId }) })
    : uploadRfc822<GmailMessage>(acc, `${UPLOAD}/messages/send`, 'POST', threadId ? { threadId } : {}, rawMime);

export const createDraft = (acc: string, rawMime: string, threadId?: string) =>
  rawMime.length < JSON_RAW_LIMIT
    ? apiJson<Draft>(acc, `${BASE}/drafts`, { method: 'POST', ...jsonBody({ message: { raw: toBase64Url(rawMime), threadId } }) })
    : uploadRfc822<Draft>(acc, `${UPLOAD}/drafts`, 'POST', { message: threadId ? { threadId } : {} }, rawMime);

export const updateDraft = (acc: string, draftId: string, rawMime: string, threadId?: string) =>
  rawMime.length < JSON_RAW_LIMIT
    ? apiJson<Draft>(acc, `${BASE}/drafts/${encodeURIComponent(draftId)}`, {
        method: 'PUT',
        ...jsonBody({ id: draftId, message: { raw: toBase64Url(rawMime), threadId } }),
      })
    : uploadRfc822<Draft>(acc, `${UPLOAD}/drafts/${encodeURIComponent(draftId)}`, 'PUT', { id: draftId, message: threadId ? { threadId } : {} }, rawMime);

export const deleteDraft = (acc: string, draftId: string) =>
  apiJson<void>(acc, `${BASE}/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });

// ---- Tiện ích đọc message ----

export function header(msg: GmailMessage | MessagePart | undefined, name: string): string {
  const headers = msg && 'payload' in msg ? msg.payload?.headers : (msg as MessagePart | undefined)?.headers;
  const lower = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? '';
}

export function gmailWebUrl(email: string, messageId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${encodeURIComponent(messageId)}`;
}
