import { render } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import '../shared/base.css';
import './compose.css';
import { isValidEmail, parseAddress, parseAddressList, splitAddressList } from '../lib/address';
import { createDraft, deleteDraft, sendMessage, updateDraft } from '../lib/gmail-client';
import { escapeHtml, textToNodes } from '../lib/html-clean';
import { htmlToText } from '../lib/mail-parse';
import { applyVariables } from '../lib/templates';
import { buildMime, bytesToBase64 } from '../lib/mime';
import { getLocal, getSession, rememberAddresses, type Account, type Template } from '../lib/storage';
import { errorText, formatBytes, Spinner } from '../shared/components';
import { initTheme } from '../shared/theme';
import { buildInitState, quoteAsNodes, quoteAsText, type ComposeAttachment, type InitState } from './compose-init';
import { RichEditor, type EditorHandle } from '../shared/editor';
import { RecipientInput } from './recipients';
import { TemplatePicker } from './template-picker';
import type { DraftPortMessage } from './draft-port';
import { ext } from '../lib/ext';

const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const AUTOSAVE_MS = 10_000;

function invalidAddresses(field: string): string[] {
  return splitAddressList(field).filter((raw) => !isValidEmail(parseAddress(raw).email));
}

function App() {
  const params = new URLSearchParams(location.search);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [init, setInit] = useState<InitState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [fromId, setFromId] = useState('');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [plain, setPlain] = useState(false);
  const [plainText, setPlainText] = useState('');
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const editor = useRef<EditorHandle | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);
  const done = useRef(false);
  const saving = useRef(false);
  const draft = useRef<{ id: string; accountId: string } | null>(null);
  const port = useRef<chrome.runtime.Port | null>(null);

  const markDirty = useCallback(() => {
    dirty.current = true;
  }, []);

  // Tải tài khoản + trạng thái ban đầu (trả lời / chuyển tiếp).
  useEffect(() => {
    void (async () => {
      try {
        const accs = await getLocal('accounts');
        setAccounts(accs);
        const seen = await getSession('seenAddresses');
        setSuggestions([...new Set([...seen, ...accs.map((a) => a.email)])]);
        const s = await buildInitState(params, accs);
        setInit(s);
        setFromId(s.accountId);
        setTo(s.to);
        setCc(s.cc);
        setBcc(s.bcc);
        setShowCc(!!(s.cc || s.bcc));
        setSubject(s.subject);
        setAttachments(s.attachments);
        if (s.quote) {
          editor.current?.setContent(quoteAsNodes(s.quote));
          setPlainText(quoteAsText(s.quote));
        }
        document.title = s.subject ? `${s.subject} — Soạn thư` : 'Soạn thư — Mail Pulse';
      } catch (e) {
        setLoadError(errorText(e));
      }
    })();
    port.current = ext.runtime.connect({ name: 'compose' });
  }, []);

  const account = accounts.find((a) => a.id === fromId);

  /** Dựng raw MIME đồng bộ từ trạng thái hiện tại (để dùng được cả trong pagehide). */
  const stateRef = useRef({ to, cc, bcc, subject, plain, plainText, attachments, account, init });
  stateRef.current = { to, cc, bcc, subject, plain, plainText, attachments, account, init };

  const buildRaw = useCallback((): string => {
    const s = stateRef.current;
    if (!s.account) throw new Error('Chưa chọn tài khoản gửi.');
    const text = s.plain ? s.plainText : (editor.current?.getText() ?? '');
    const html = s.plain ? undefined : editor.current?.getHtml();
    return buildMime({
      from: { name: s.account.name, email: s.account.email },
      to: parseAddressList(s.to),
      cc: parseAddressList(s.cc),
      bcc: parseAddressList(s.bcc),
      subject: s.subject,
      text,
      html,
      inReplyTo: s.init?.inReplyTo,
      references: s.init?.references,
      attachments: s.attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType, base64: a.base64 })),
    });
  }, []);

  const saveDraft = useCallback(async () => {
    const acc = stateRef.current.account;
    if (!dirty.current || saving.current || done.current || !acc) return;
    saving.current = true;
    dirty.current = false;
    setStatus('Đang lưu nháp…');
    try {
      const raw = buildRaw();
      const threadId = stateRef.current.init?.threadId;
      // Đổi tài khoản gửi -> bỏ nháp ở tài khoản cũ.
      if (draft.current && draft.current.accountId !== acc.id) {
        void deleteDraft(draft.current.accountId, draft.current.id).catch(() => undefined);
        draft.current = null;
      }
      const d = draft.current ? await updateDraft(acc.id, draft.current.id, raw, threadId) : await createDraft(acc.id, raw, threadId);
      draft.current = { id: d.id, accountId: acc.id };
      setStatus(`Đã lưu nháp lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (e) {
      dirty.current = true;
      setStatus(`Lưu nháp lỗi: ${errorText(e)}`);
    } finally {
      saving.current = false;
    }
  }, [buildRaw]);

  // Tự lưu nháp mỗi 10 giây.
  useEffect(() => {
    const t = window.setInterval(() => void saveDraft(), AUTOSAVE_MS);
    return () => window.clearInterval(t);
  }, [saveDraft]);

  // Đóng cửa sổ: giao việc lưu nháp cuối cho service worker (trang sắp bị huỷ, không chờ được fetch).
  useEffect(() => {
    const onHide = () => {
      const acc = stateRef.current.account;
      if (!dirty.current || done.current || !acc) return;
      try {
        const msg: DraftPortMessage = {
          type: 'save-draft',
          accountId: acc.id,
          draftId: draft.current?.accountId === acc.id ? draft.current.id : undefined,
          threadId: stateRef.current.init?.threadId,
          raw: buildRaw(),
        };
        port.current?.postMessage(msg);
      } catch {
        /* không làm gì được nữa */
      }
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [buildRaw]);

  const totalBytes = attachments.reduce((s, a) => s + a.size, 0);

  const addFiles = async (files: FileList | File[]) => {
    setError('');
    let total = totalBytes;
    const added: ComposeAttachment[] = [];
    for (const f of Array.from(files)) {
      if (total + f.size > MAX_TOTAL_BYTES) {
        setError(`Tổng dung lượng đính kèm vượt quá 25MB — bỏ qua "${f.name}".`);
        continue;
      }
      total += f.size;
      added.push({
        id: crypto.randomUUID(),
        filename: f.name,
        mimeType: f.type || 'application/octet-stream',
        size: f.size,
        base64: bytesToBase64(new Uint8Array(await f.arrayBuffer())),
      });
    }
    if (added.length) {
      setAttachments((cur) => [...cur, ...added]);
      markDirty();
    }
  };

  const switchMode = (toPlain: boolean) => {
    if (toPlain === plain) return;
    if (toPlain) setPlainText(editor.current?.getText() ?? '');
    else editor.current?.setContent(textToNodes(plainText));
    setPlain(toPlain);
    markDirty();
  };

  const plainRef = useRef<HTMLTextAreaElement>(null);

  const applyTemplate = (t: Template, values: Record<string, string>) => {
    const subj = applyVariables(t.subject, values);
    if (subj && (!subject.trim() || (subj !== subject && confirm('Thay tiêu đề hiện tại bằng tiêu đề của template?')))) setSubject(subj);
    const html = applyVariables(t.body, values, escapeHtml);
    if (plain) {
      const text = htmlToText(html);
      const ta = plainRef.current;
      const pos = ta?.selectionStart ?? 0;
      setPlainText((cur) => cur.slice(0, pos) + text + cur.slice(pos));
    } else {
      editor.current?.insertHtml(html);
    }
    if (t.accountId && params.get('mode') !== 'reply' && params.get('mode') !== 'replyAll' && accounts.some((a) => a.id === t.accountId && !a.needsReauth)) {
      setFromId(t.accountId);
    }
    markDirty();
  };

  const send = async () => {
    setError('');
    const all = [to, cc, bcc];
    if (!all.some((f) => parseAddressList(f).length)) return setError('Cần ít nhất một người nhận.');
    const bad = all.flatMap(invalidAddresses);
    if (bad.length) return setError(`Địa chỉ không hợp lệ: ${bad.join(', ')}`);
    if (!account) return setError('Chưa chọn tài khoản gửi.');
    if (!subject.trim() && !confirm('Gửi thư không có tiêu đề?')) return;
    setSending(true);
    try {
      const raw = buildRaw();
      await sendMessage(account.id, raw, init?.threadId);
      done.current = true;
      dirty.current = false;
      if (draft.current) await deleteDraft(draft.current.accountId, draft.current.id).catch(() => undefined);
      void rememberAddresses(splitAddressList([to, cc, bcc].join(',')));
      setStatus('Đã gửi.');
      window.close();
    } catch (e) {
      setError(`Gửi thất bại: ${errorText(e)}`);
    } finally {
      setSending(false);
    }
  };

  const discard = async () => {
    if (!confirm('Huỷ thư này? Bản nháp (nếu có) sẽ bị xoá.')) return;
    done.current = true;
    dirty.current = false;
    if (draft.current) await deleteDraft(draft.current.accountId, draft.current.id).catch(() => undefined);
    window.close();
  };

  if (loadError) return <div class="banner" style={{ margin: '16px' }}>{loadError}</div>;

  return (
    <div
      class="compose col"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void send();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer?.files.length) void addFiles(e.dataTransfer.files);
      }}
    >
      {!init && (
        <div class="row center">
          <Spinner /> <span class="muted">Đang tải…</span>
        </div>
      )}
      <div class="field-row">
        <label class="field-label" for="from">
          Từ
        </label>
        <select
          id="from"
          class="grow"
          value={fromId}
          onChange={(e) => {
            setFromId(e.currentTarget.value);
            markDirty();
          }}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id} disabled={a.needsReauth}>
              {a.name} &lt;{a.email}&gt;{a.needsReauth ? ' — cần đăng nhập lại' : ''}
            </option>
          ))}
        </select>
        {!showCc && (
          <button class="ghost" onClick={() => setShowCc(true)}>
            Cc/Bcc
          </button>
        )}
      </div>
      <RecipientInput label="Tới" value={to} onChange={(v) => (setTo(v), markDirty())} suggestions={suggestions} autoFocus={!to} />
      {showCc && (
        <>
          <RecipientInput label="Cc" value={cc} onChange={(v) => (setCc(v), markDirty())} suggestions={suggestions} />
          <RecipientInput label="Bcc" value={bcc} onChange={(v) => (setBcc(v), markDirty())} suggestions={suggestions} />
        </>
      )}
      <div class="field-row">
        <label class="field-label" for="subject">
          Tiêu đề
        </label>
        <input
          id="subject"
          class="grow"
          value={subject}
          onInput={(e) => {
            setSubject(e.currentTarget.value);
            markDirty();
          }}
        />
      </div>

      <div class="row mode-row">
        <div class="row segmented" role="group" aria-label="Chế độ soạn">
          <button aria-pressed={!plain} onClick={() => switchMode(false)}>
            Định dạng
          </button>
          <button aria-pressed={plain} onClick={() => switchMode(true)}>
            Văn bản thuần
          </button>
        </div>
        <span class="spacer" />
        <TemplatePicker to={to} onApply={applyTemplate} />
      </div>

      <div class={plain ? 'hidden' : 'grow col'}>
        <RichEditor handle={editor} onChange={markDirty} />
      </div>
      {plain && (
        <textarea
          ref={plainRef}
          class="plain-editor grow"
          value={plainText}
          aria-label="Nội dung thư"
          onInput={(e) => {
            setPlainText(e.currentTarget.value);
            markDirty();
          }}
        />
      )}

      {attachments.length > 0 && (
        <div class="row wrap attach-list">
          {attachments.map((a) => (
            <span class="attach-chip" key={a.id}>
              <span class="ellipsis">{a.filename}</span>
              <span class="muted small">{formatBytes(a.size)}</span>
              <button
                class="ghost icon"
                aria-label={`Bỏ ${a.filename}`}
                onClick={() => {
                  setAttachments((cur) => cur.filter((x) => x.id !== a.id));
                  markDirty();
                }}
              >
                ×
              </button>
            </span>
          ))}
          <span class="muted small">Tổng {formatBytes(totalBytes)} / 25 MB</span>
        </div>
      )}

      {error && <div class="banner">{error}</div>}

      <footer class="row compose-footer">
        <button class="primary" disabled={sending || !init} onClick={() => void send()} title="Ctrl+Enter">
          {sending ? 'Đang gửi…' : 'Gửi'}
        </button>
        <button onClick={() => fileInput.current?.click()}>Đính kèm</button>
        <input
          ref={fileInput}
          type="file"
          multiple
          class="hidden"
          onChange={(e) => {
            const files = e.currentTarget.files;
            if (files) void addFiles(files).then(() => (e.currentTarget.value = ''));
          }}
        />
        <span class="spacer" />
        <span class="muted small">{status}</span>
        <button class="ghost" onClick={() => void saveDraft()} disabled={!init}>
          Lưu nháp
        </button>
        <button class="ghost danger" onClick={() => void discard()}>
          Huỷ
        </button>
      </footer>
    </div>
  );
}

void initTheme();
render(<App />, document.getElementById('app')!);
