import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { displayName, parseAddressList } from '../lib/address';
import { getAttachment, getMessage, gmailWebUrl, header, modifyMessage, type GmailMessage } from '../lib/gmail-client';
import { base64UrlToBase64, base64UrlToBytes, parseMessage, type AttachmentInfo, type ParsedBody } from '../lib/mail-parse';
import { plainTextDocument, sanitizeEmailHtml } from '../lib/sanitize';
import { rememberAddresses, type Account } from '../lib/storage';
import { errorText, formatBytes, Spinner, type ToastState } from '../shared/components';
import { openCompose, sendToBackground } from '../shared/messages';
import type { MailItem } from './mail-store';
import { ext } from '../lib/ext';

interface Props {
  account: Account;
  messageId: string;
  onBack: () => void;
  onRead: (read: boolean) => void;
  onArchive: (item: MailItem) => void;
  onTrash: (item: MailItem) => void;
  showToast: (t: ToastState | null) => void;
}

const MAX_INLINE_BYTES = 8 * 1024 * 1024;

async function buildCidMap(accountId: string, messageId: string, body: ParsedBody): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  let total = 0;
  for (const img of body.inline) {
    try {
      const data = img.data ?? (img.attachmentId ? (await getAttachment(accountId, messageId, img.attachmentId)).data : undefined);
      if (!data) continue;
      total += data.length;
      if (total > MAX_INLINE_BYTES) break;
      map[img.cid] = `data:${img.mimeType};base64,${base64UrlToBase64(data)}`;
    } catch {
      /* bỏ qua ảnh lỗi */
    }
  }
  return map;
}

function toItem(account: Account, m: GmailMessage): MailItem {
  return {
    key: `${account.id}:${m.id}`,
    accountId: account.id,
    id: m.id,
    threadId: m.threadId,
    from: header(m, 'From'),
    subject: header(m, 'Subject'),
    snippet: m.snippet ?? '',
    date: Number(m.internalDate ?? 0),
    unread: false,
    labelIds: m.labelIds ?? [],
  };
}

export function MessageView({ account, messageId, onBack, onRead, onArchive, onTrash, showToast }: Props) {
  const [msg, setMsg] = useState<GmailMessage | null>(null);
  const [body, setBody] = useState<ParsedBody | null>(null);
  const [cidMap, setCidMap] = useState<Record<string, string>>({});
  const [showImages, setShowImages] = useState(false);
  const [error, setError] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let alive = true;
    setMsg(null);
    setBody(null);
    setShowImages(false);
    setShowDetails(false);
    setError('');
    void (async () => {
      try {
        const m = await getMessage(account.id, messageId, 'full');
        if (!alive) return;
        const parsed = parseMessage(m);
        setMsg(m);
        setBody(parsed);
        void rememberAddresses(['From', 'To', 'Cc'].flatMap((h) => parseAddressList(header(m, h)).map((a) => (a.name ? `${a.name} <${a.email}>` : a.email))));
        if (m.labelIds?.includes('UNREAD')) {
          await modifyMessage(account.id, m.id, [], ['UNREAD']);
          onRead(true);
          void sendToBackground({ type: 'refresh-badge' });
        }
        if (parsed.inline.length) {
          const map = await buildCidMap(account.id, m.id, parsed);
          if (alive) setCidMap(map);
        }
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [account.id, messageId]);

  const dark = document.documentElement.dataset.theme === 'dark';
  const rendered = useMemo(() => {
    if (!body) return null;
    if (body.html) return sanitizeEmailHtml(body.html, { allowRemoteImages: showImages, cidMap });
    return { html: plainTextDocument(body.text ?? '', dark), hasRemoteImages: false };
  }, [body, showImages, cidMap, dark]);

  // Thu nhỏ thư HTML rộng (thường thiết kế cho ~600px) cho vừa khung, tự co giãn chiều cao iframe,
  // chặn click link để mở tab mới / soạn thư.
  const onFrameLoad = () => {
    const f = frame.current;
    const doc = f?.contentDocument;
    if (!f || !doc) return;
    const body = doc.body;
    let zoom = 1;
    const fitWidth = () => {
      // Đo bề rộng tự nhiên (zoom = 1) rồi thu nhỏ vừa iframe; không thu nhỏ quá 40%.
      body.style.zoom = '1';
      const natural = doc.documentElement.scrollWidth;
      const avail = f.clientWidth;
      zoom = natural > avail + 1 ? Math.max(0.4, avail / natural) : 1;
      body.style.zoom = String(zoom);
    };
    const fitHeight = () => {
      f.style.height = `${Math.max(80, Math.ceil(doc.documentElement.scrollHeight))}px`;
    };
    fitWidth();
    fitHeight();
    // Ảnh tải xong có thể làm thư rộng ra -> tính lại.
    doc.querySelectorAll('img').forEach((img) => img.addEventListener('load', () => (fitWidth(), fitHeight()), { once: true }));
    new ResizeObserver(fitHeight).observe(body);
    doc.addEventListener('click', (e) => {
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      if (href.startsWith('#')) return;
      e.preventDefault();
      if (/^mailto:/i.test(href)) {
        const to = decodeURIComponent(href.slice(7).split('?')[0] ?? '');
        openCompose({ mode: 'new', account: account.id, to });
      } else if (/^https?:\/\//i.test(href)) {
        void ext.tabs.create({ url: href, active: true });
      }
    });
  };

  const download = async (att: AttachmentInfo) => {
    try {
      const data = att.data ?? (att.attachmentId ? (await getAttachment(account.id, messageId, att.attachmentId)).data : '');
      const blob = new Blob([base64UrlToBytes(data)], { type: att.mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      showToast({ text: `Tải ${att.filename} thất bại: ${errorText(e)}` });
    }
  };

  const markUnread = async () => {
    try {
      await modifyMessage(account.id, messageId, ['UNREAD'], []);
      onRead(false);
      void sendToBackground({ type: 'refresh-badge' });
      onBack();
    } catch (e) {
      showToast({ text: errorText(e) });
    }
  };

  const compose = (mode: 'reply' | 'replyAll' | 'forward') => openCompose({ mode, account: account.id, id: messageId });

  return (
    <div class="message-view col">
      <div class="row toolbar">
        <button class="ghost" onClick={onBack}>
          ← Quay lại
        </button>
        <span class="spacer" />
        {msg && (
          <>
            <button class="ghost" title="Archive" onClick={() => onArchive(toItem(account, msg))}>
              Archive
            </button>
            <button class="ghost danger" title="Chuyển vào Thùng rác" onClick={() => onTrash(toItem(account, msg))}>
              Xoá
            </button>
            <button class="ghost" onClick={markUnread}>
              Chưa đọc
            </button>
            <a class="btn ghost" href={gmailWebUrl(account.email, messageId)} target="_blank" rel="noopener noreferrer" title="Mở trên Gmail">
              ↗
            </a>
          </>
        )}
      </div>

      {error && <div class="banner">{error}</div>}
      {!msg && !error && (
        <div class="row center">
          <Spinner />
        </div>
      )}

      {msg && (
        <>
          <h2 class="msg-subject">{header(msg, 'Subject') || '(không tiêu đề)'}</h2>
          <div class="msg-head">
            <button class="msg-from" onClick={() => setShowDetails((v) => !v)} title={showDetails ? 'Ẩn chi tiết' : 'Xem chi tiết'}>
              <span class="row">
                <strong class="grow ellipsis">{displayName(header(msg, 'From'))}</strong>
                <span class="muted small nowrap">{formatWhen(Number(msg.internalDate))}</span>
              </span>
              <span class="muted small ellipsis">
                tới {shortRecipients(header(msg, 'To'), header(msg, 'Cc'))} {showDetails ? '▴' : '▾'}
              </span>
            </button>
            <button class="ghost icon" title="Trả lời" onClick={() => compose('reply')}>
              ↩
            </button>
          </div>
          {showDetails && (
            <div class="msg-details small">
              <div><span class="muted">Từ:</span> {header(msg, 'From')}</div>
              <div><span class="muted">Tới:</span> {header(msg, 'To')}</div>
              {header(msg, 'Cc') && <div><span class="muted">Cc:</span> {header(msg, 'Cc')}</div>}
              <div><span class="muted">Ngày:</span> {new Date(Number(msg.internalDate)).toLocaleString('vi-VN')}</div>
              <div><span class="muted">Hộp thư:</span> <span style={{ color: account.color }}>{account.email}</span></div>
            </div>
          )}

          {rendered?.hasRemoteImages && !showImages && (
            <div class="img-notice small muted">
              Ảnh đã bị chặn để tránh bị theo dõi.{' '}
              <button class="linkish" onClick={() => setShowImages(true)}>Hiện ảnh</button>
            </div>
          )}

          {rendered && (
            <iframe
              ref={frame}
              class={`mail-frame${body?.html ? ' html' : ''}`}
              title="Nội dung thư"
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              referrerpolicy="no-referrer"
              srcDoc={rendered.html}
              onLoad={onFrameLoad}
            />
          )}

          {body && body.attachments.length > 0 && (
            <div class="col attachments">
              <h3>Tệp đính kèm ({body.attachments.length})</h3>
              {body.attachments.map((att) => (
                <div class="row attachment" key={att.partId + att.filename}>
                  <span class="grow ellipsis">{att.filename}</span>
                  <span class="muted small">{formatBytes(att.size)}</span>
                  <button onClick={() => void download(att)}>Tải về</button>
                </div>
              ))}
            </div>
          )}

          <div class="row wrap reply-bar">
            <button onClick={() => compose('reply')}>↩ Trả lời</button>
            <button onClick={() => compose('replyAll')}>Trả lời tất cả</button>
            <button onClick={() => compose('forward')}>↪ Chuyển tiếp</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Hôm nay -> "14:05"; năm nay -> "14 thg 11"; khác năm -> "14/11/2025". */
function formatWhen(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('vi-VN', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('vi-VN');
}

/** "tôi, An, Bình +2" — tên ngắn gọn của người nhận (To + Cc). */
function shortRecipients(to: string, cc: string): string {
  const names = [...parseAddressList(to), ...parseAddressList(cc)].map((a) => a.name || a.email.split('@')[0] || a.email);
  if (!names.length) return '(không rõ)';
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
}
