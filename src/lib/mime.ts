/**
 * Tạo thư MIME RFC 2822 / RFC 2045:
 *   multipart/mixed
 *     ├─ multipart/alternative (text/plain + text/html)   — hoặc chỉ text/plain ở chế độ plain
 *     └─ attachments (base64)
 * Mọi phần thân đều base64 nên toàn bộ thư là ASCII.
 */
import { formatAddress, type Address } from './address';

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  /** base64 chuẩn (không phải base64url), không xuống dòng */
  base64: string;
}

export interface MimeInput {
  from: Address;
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: MimeAttachment[];
  date?: Date;
  /** Cho test: boundary cố định */
  boundarySeed?: string;
}

const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);
/** Chống header injection. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function utf8ToBase64(s: string): string {
  return bytesToBase64(new TextEncoder().encode(s));
}

export function base64ToBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url của chuỗi ASCII (raw MIME) — định dạng trường `raw` của Gmail API. */
export function toBase64Url(ascii: string): string {
  return base64ToBase64Url(btoa(ascii));
}

export function wrap76(b64: string): string {
  return b64.replace(/.{76}/g, '$&\r\n').replace(/\r\n$/, '');
}

/** RFC 2047 encoded-word, mỗi word ≤ 75 ký tự (tách theo ký tự, không cắt giữa chuỗi UTF-8). */
export function encodeHeaderWord(value: string): string {
  const s = oneLine(value);
  if (isAscii(s)) return s;
  const words: string[] = [];
  let cur = '';
  const enc = new TextEncoder();
  for (const ch of s) {
    if (enc.encode(cur + ch).length > 45) {
      words.push(cur);
      cur = '';
    }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${utf8ToBase64(w)}?=`).join('\r\n ');
}

export function encodeAddressHeader(list: Address[]): string {
  return list
    .map((a) => {
      const email = oneLine(a.email);
      const name = oneLine(a.name);
      if (!name) return email;
      return isAscii(name) ? formatAddress({ name, email }) : `${encodeHeaderWord(name)} <${email}>`;
    })
    .join(',\r\n ');
}

function filenameParams(filename: string): { type: string; disposition: string } {
  const clean = oneLine(filename).replace(/["\\]/g, '_');
  if (isAscii(clean)) return { type: `name="${clean}"`, disposition: `filename="${clean}"` };
  const pct = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return { type: `name="${encodeHeaderWord(clean)}"`, disposition: `filename*=UTF-8''${pct}` };
}

function boundary(seed: string, n: number): string {
  return `=_mp_${seed}_${n}`;
}

export function buildMime(input: MimeInput): string {
  const seed = input.boundarySeed ?? crypto.randomUUID().replace(/-/g, '');
  const CRLF = '\r\n';
  const headers: string[] = [
    `From: ${encodeAddressHeader([input.from])}`,
    ...(input.to.length ? [`To: ${encodeAddressHeader(input.to)}`] : []),
    ...(input.cc?.length ? [`Cc: ${encodeAddressHeader(input.cc)}`] : []),
    ...(input.bcc?.length ? [`Bcc: ${encodeAddressHeader(input.bcc)}`] : []),
    `Subject: ${encodeHeaderWord(input.subject)}`,
    `Date: ${(input.date ?? new Date()).toUTCString().replace('GMT', '+0000')}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${oneLine(input.inReplyTo)}`] : []),
    ...(input.references ? [`References: ${oneLine(input.references)}`] : []),
    'MIME-Version: 1.0',
  ];

  const textPart = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(utf8ToBase64(input.text))].join(CRLF);
  let bodyPart: string;
  if (input.html !== undefined) {
    const b = boundary(seed, 2);
    const htmlPart = ['Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(utf8ToBase64(input.html))].join(CRLF);
    bodyPart = [`Content-Type: multipart/alternative; boundary="${b}"`, '', `--${b}`, textPart, `--${b}`, htmlPart, `--${b}--`].join(CRLF);
  } else {
    bodyPart = textPart;
  }

  const atts = input.attachments ?? [];
  if (!atts.length) return [...headers, bodyPart].join(CRLF);

  const b = boundary(seed, 1);
  const parts = atts.map((a) => {
    const p = filenameParams(a.filename);
    return [
      `Content-Type: ${oneLine(a.mimeType) || 'application/octet-stream'}; ${p.type}`,
      `Content-Disposition: attachment; ${p.disposition}`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(a.base64),
    ].join(CRLF);
  });
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${b}"`,
    '',
    `--${b}`,
    bodyPart,
    ...parts.flatMap((p) => [`--${b}`, p]),
    `--${b}--`,
  ].join(CRLF);
}

export function replySubject(subject: string, kind: 'reply' | 'forward'): string {
  const s = subject.trim();
  if (kind === 'reply') return /^(re|tl|aw|sv)\s*:/i.test(s) ? s : `Re: ${s}`;
  return /^(fwd?|tr|wg)\s*:/i.test(s) ? s : `Fwd: ${s}`;
}
