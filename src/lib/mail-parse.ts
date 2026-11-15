/** Phân tích payload format=full của Gmail: lấy phần html/text, file đính kèm, ảnh inline (cid). */
import type { GmailMessage, MessagePart } from './gmail-client';

export function base64UrlToBytes(data: string): Uint8Array<ArrayBuffer> {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64UrlToBase64(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return b64 + '='.repeat((4 - (b64.length % 4)) % 4);
}

function partHeader(part: MessagePart, name: string): string {
  const lower = name.toLowerCase();
  return part.headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? '';
}

function charsetOf(part: MessagePart): string {
  const m = /charset\s*=\s*"?([^";\s]+)"?/i.exec(partHeader(part, 'Content-Type'));
  return m?.[1]?.toLowerCase() ?? 'utf-8';
}

export function decodePartText(part: MessagePart): string {
  const data = part.body?.data;
  if (!data) return '';
  const bytes = base64UrlToBytes(data);
  try {
    return new TextDecoder(charsetOf(part)).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export interface AttachmentInfo {
  partId: string;
  filename: string;
  mimeType: string;
  size: number;
  attachmentId?: string;
  /** Dữ liệu nhỏ có thể nằm sẵn trong body.data */
  data?: string;
}

export interface InlineImage {
  cid: string;
  mimeType: string;
  attachmentId?: string;
  data?: string;
}

export interface ParsedBody {
  html: string | null;
  text: string | null;
  attachments: AttachmentInfo[];
  inline: InlineImage[];
}

export function parseMessage(msg: GmailMessage): ParsedBody {
  const result: ParsedBody = { html: null, text: null, attachments: [], inline: [] };
  const walk = (part: MessagePart) => {
    const mime = part.mimeType.toLowerCase();
    if (part.parts?.length) {
      for (const p of part.parts) walk(p);
      return;
    }
    const disposition = partHeader(part, 'Content-Disposition').toLowerCase();
    const cid = partHeader(part, 'Content-ID').replace(/^<|>$/g, '');
    const isAttachment = !!part.filename || disposition.startsWith('attachment');
    if (cid && mime.startsWith('image/') && !disposition.startsWith('attachment')) {
      result.inline.push({ cid, mimeType: mime, attachmentId: part.body?.attachmentId, data: part.body?.data });
      if (!part.filename) return;
    }
    if (isAttachment) {
      result.attachments.push({
        partId: part.partId ?? '',
        filename: part.filename || 'tep-dinh-kem',
        mimeType: mime,
        size: part.body?.size ?? 0,
        attachmentId: part.body?.attachmentId,
        data: part.body?.data,
      });
      return;
    }
    if (mime === 'text/html' && result.html === null) result.html = decodePartText(part);
    else if (mime === 'text/plain' && result.text === null) result.text = decodePartText(part);
  };
  if (msg.payload) walk(msg.payload);
  return result;
}

/** Chuyển HTML thành text (dùng DOMParser — tài liệu trơ, không chạy script). Chỉ dùng trong trang có DOM. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,head,title').forEach((n) => n.remove());
  doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
  doc.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,h5,h6,blockquote').forEach((n) => n.append('\n'));
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}
