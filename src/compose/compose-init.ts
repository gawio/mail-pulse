/** Dựng trạng thái ban đầu cho cửa sổ soạn thư từ tham số URL (thư mới / trả lời / chuyển tiếp). */
import { parseAddressList, formatAddress, type Address } from '../lib/address';
import { getAttachment, getMessage, header } from '../lib/gmail-client';
import { base64UrlToBase64, htmlToText, parseMessage } from '../lib/mail-parse';
import { replySubject } from '../lib/mime';
import type { Account } from '../lib/storage';

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

export interface ComposeAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  base64: string;
}

export interface Quote {
  kind: 'reply' | 'forward';
  /** Dòng giới thiệu, vd "Vào …, X đã viết:" */
  intro: string;
  text: string;
}

export interface InitState {
  accountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  quote?: Quote;
  attachments: ComposeAttachment[];
}

const fmtList = (list: Address[]) => list.map(formatAddress).join(', ');

export async function buildInitState(params: URLSearchParams, accounts: Account[]): Promise<InitState> {
  const mode = (params.get('mode') ?? 'new') as ComposeMode;
  const fallback = accounts.find((a) => !a.needsReauth) ?? accounts[0];
  const account = accounts.find((a) => a.id === params.get('account')) ?? fallback;
  if (!account) throw new Error('Chưa có tài khoản nào. Hãy thêm tài khoản trong Cài đặt.');

  const base: InitState = {
    accountId: account.id,
    to: params.get('to') ?? '',
    cc: '',
    bcc: '',
    subject: params.get('subject') ?? '',
    attachments: [],
  };
  const id = params.get('id');
  if (mode === 'new' || !id) return base;

  const msg = await getMessage(account.id, id, 'full');
  const body = parseMessage(msg);
  const text = body.text ?? (body.html ? htmlToText(body.html) : '');
  const from = header(msg, 'From');
  const date = new Date(Number(msg.internalDate ?? Date.now())).toLocaleString('vi-VN');
  const messageId = header(msg, 'Message-ID') || header(msg, 'Message-Id');
  const refs = [header(msg, 'References'), messageId].filter(Boolean).join(' ').trim();
  const me = account.email.toLowerCase();
  const notMe = (a: Address) => a.email.toLowerCase() !== me;

  base.threadId = msg.threadId;
  if (messageId) {
    base.inReplyTo = messageId;
    base.references = refs;
  }

  if (mode === 'forward') {
    base.subject = replySubject(header(msg, 'Subject'), 'forward');
    base.quote = {
      kind: 'forward',
      intro: '---------- Thư được chuyển tiếp ----------',
      text: [`Từ: ${from}`, `Ngày: ${date}`, `Tiêu đề: ${header(msg, 'Subject')}`, `Tới: ${header(msg, 'To')}`, header(msg, 'Cc') ? `Cc: ${header(msg, 'Cc')}` : '', '', text]
        .filter((l, i) => l !== '' || i === 5)
        .join('\n'),
    };
    // Đính kèm gốc được tải sẵn để có thể lưu nháp đồng bộ khi đóng cửa sổ.
    for (const att of body.attachments) {
      const data = att.data ?? (att.attachmentId ? (await getAttachment(account.id, msg.id, att.attachmentId)).data : '');
      if (!data) continue;
      base.attachments.push({ id: crypto.randomUUID(), filename: att.filename, mimeType: att.mimeType, size: att.size, base64: base64UrlToBase64(data) });
    }
    return base;
  }

  const replyTo = parseAddressList(header(msg, 'Reply-To'));
  const fromList = parseAddressList(from);
  const sentByMe = fromList.some((a) => !notMe(a));
  // Nếu chính mình gửi thư gốc, trả lời tới người nhận ban đầu.
  const primary = sentByMe ? parseAddressList(header(msg, 'To')) : replyTo.length ? replyTo : fromList;
  base.subject = replySubject(header(msg, 'Subject'), 'reply');
  base.to = fmtList(primary);
  if (mode === 'replyAll') {
    const seen = new Set(primary.map((a) => a.email.toLowerCase()));
    const others = [...parseAddressList(header(msg, 'To')), ...parseAddressList(header(msg, 'Cc'))].filter((a) => {
      const k = a.email.toLowerCase();
      if (seen.has(k) || !notMe(a)) return false;
      seen.add(k);
      return true;
    });
    base.cc = fmtList(others);
  }
  base.quote = { kind: 'reply', intro: `Vào ${date}, ${from} đã viết:`, text };
  return base;
}

/** Nội dung trích dẫn dạng text thuần (chế độ plain). */
export function quoteAsText(q: Quote): string {
  if (q.kind === 'forward') return `\n\n${q.intro}\n${q.text}`;
  return `\n\n${q.intro}\n${q.text.split('\n').map((l) => `> ${l}`).join('\n')}`;
}

/** Nội dung trích dẫn dạng DOM (chế độ rich) — dựng bằng textContent, không innerHTML. */
export function quoteAsNodes(q: Quote, doc: Document = document): DocumentFragment {
  const frag = doc.createDocumentFragment();
  for (let i = 0; i < 2; i++) {
    const p = doc.createElement('div');
    p.appendChild(doc.createElement('br'));
    frag.appendChild(p);
  }
  const intro = doc.createElement('div');
  intro.textContent = q.intro;
  frag.appendChild(intro);
  const container = doc.createElement(q.kind === 'reply' ? 'blockquote' : 'div');
  q.text.split('\n').forEach((line, i) => {
    if (i) container.appendChild(doc.createElement('br'));
    container.appendChild(doc.createTextNode(line));
  });
  frag.appendChild(container);
  return frag;
}
