import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { displayName } from '../lib/address';
import { gmailWebUrl } from '../lib/gmail-client';
import { getSession, onStorageChange, setSession, type Account } from '../lib/storage';
import { errorText, Spinner, type ToastState } from '../shared/components';
import { archive, formatTime, loadNextPage, markRead, trash, unarchive, untrash, type MailItem, type PageState } from './mail-store';
import { MessageView } from './message-view';

interface Props {
  /** Các tài khoản đang xem (1 hoặc tất cả). */
  accounts: Account[];
  allAccounts: Account[];
  showToast: (t: ToastState | null) => void;
}

function mergeItems(list: MailItem[], add: MailItem[]): MailItem[] {
  const map = new Map(list.map((i) => [i.key, i]));
  for (const i of add) map.set(i.key, i);
  return [...map.values()].sort((a, b) => b.date - a.date);
}

export function Inbox({ accounts, allAccounts, showToast }: Props) {
  const [items, setItems] = useState<MailItem[]>([]);
  const [page, setPage] = useState<PageState>({ tokens: {}, started: false });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [draftQuery, setDraftQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<{ accountId: string; id: string } | null>(null);
  const loadSeq = useRef(0);
  const multi = accounts.length > 1;
  const accountKey = accounts.map((a) => a.id).join(',');
  const byId = useMemo(() => new Map(allAccounts.map((a) => [a.id, a])), [allAccounts]);

  const load = useCallback(
    async (reset: boolean) => {
      const seq = ++loadSeq.current;
      setLoading(true);
      try {
        const r = await loadNextPage(accounts, query, reset ? { tokens: {}, started: false } : page);
        if (seq !== loadSeq.current) return;
        setItems((cur) => (reset ? r.items : mergeItems(cur, r.items)));
        setPage(r.state);
        setErrors(r.errors);
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [accountKey, query, page],
  );

  // Tải lại khi đổi tài khoản/từ khoá.
  useEffect(() => {
    setSelected(new Set());
    void load(true);
  }, [accountKey, query]);

  // Có mail mới (poller cập nhật số unread) -> làm mới trang đầu một cách nhẹ nhàng.
  useEffect(
    () =>
      onStorageChange('session', 'unread', () => {
        if (query || loading) return;
        void loadNextPage(accounts, '', { tokens: {}, started: false }).then((r) => setItems((cur) => mergeItems(cur, r.items)));
      }),
    [accountKey, query, loading],
  );

  // Mở mail được yêu cầu từ thông báo.
  useEffect(() => {
    const check = async () => {
      const p = await getSession('pendingOpen');
      if (p && Date.now() - p.at < 2 * 60_000) {
        await setSession('pendingOpen', null);
        setOpen({ accountId: p.accountId, id: p.messageId });
      }
    };
    void check();
    return onStorageChange('session', 'pendingOpen', () => void check());
  }, []);

  const selectedItems = items.filter((i) => selected.has(i.key));

  const patchItems = (keys: Set<string>, patch: Partial<MailItem>) =>
    setItems((cur) => cur.map((i) => (keys.has(i.key) ? { ...i, ...patch } : i)));

  const doMarkRead = async (list: MailItem[], read: boolean) => {
    const keys = new Set(list.map((i) => i.key));
    patchItems(keys, { unread: !read });
    try {
      await markRead(list, read);
    } catch (e) {
      patchItems(keys, { unread: read });
      showToast({ text: errorText(e) });
    }
  };

  const removeWithUndo = async (list: MailItem[], kind: 'archive' | 'trash') => {
    if (!list.length) return;
    const keys = new Set(list.map((i) => i.key));
    setItems((cur) => cur.filter((i) => !keys.has(i.key)));
    setSelected(new Set());
    if (open && keys.has(`${open.accountId}:${open.id}`)) setOpen(null);
    try {
      await (kind === 'archive' ? archive(list) : trash(list));
    } catch (e) {
      setItems((cur) => mergeItems(cur, list));
      showToast({ text: errorText(e) });
      return;
    }
    const n = list.length;
    showToast({
      text: kind === 'archive' ? `Đã archive ${n} thư` : `Đã chuyển ${n} thư vào Thùng rác`,
      ms: 5000,
      action: {
        label: 'Hoàn tác',
        run: () => {
          void (kind === 'archive' ? unarchive(list) : untrash(list))
            .then(() => {
              setItems((cur) => mergeItems(cur, list));
              showToast({ text: 'Đã hoàn tác', ms: 2000 });
            })
            .catch((e: unknown) => showToast({ text: errorText(e) }));
        },
      },
    });
  };

  const toggle = (key: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allSelected = items.length > 0 && selected.size === items.length;
  const hasMore = page.started && Object.values(page.tokens).some(Boolean);

  const openItem = open && items.find((i) => i.accountId === open.accountId && i.id === open.id);
  const openAccount = open ? byId.get(open.accountId) : undefined;

  return (
    <div class="inbox">
      {open && openAccount && (
        <MessageView
          account={openAccount}
          messageId={open.id}
          onBack={() => setOpen(null)}
          onRead={(read) => openItem && patchItems(new Set([openItem.key]), { unread: !read })}
          onArchive={(item) => removeWithUndo([openItem ?? item], 'archive')}
          onTrash={(item) => removeWithUndo([openItem ?? item], 'trash')}
          showToast={showToast}
        />
      )}
      <div class={open ? 'hidden' : 'col inbox-list'}>
        <form
          class="row search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(draftQuery.trim());
          }}
        >
          <input
            class="grow"
            type="search"
            placeholder="Tìm kiếm (cú pháp Gmail, vd: from:an is:unread)"
            value={draftQuery}
            onInput={(e) => {
              setDraftQuery(e.currentTarget.value);
              if (!e.currentTarget.value && query) setQuery('');
            }}
          />
          <button type="button" class="ghost icon" title="Làm mới" onClick={() => void load(true)} disabled={loading}>
            ↻
          </button>
        </form>

        <div class="row toolbar">
          <input
            type="checkbox"
            aria-label="Chọn tất cả"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.key)))}
          />
          {selected.size > 0 ? (
            <>
              <span class="small muted">{selected.size} đã chọn</span>
              <span class="spacer" />
              <button class="ghost" onClick={() => doMarkRead(selectedItems, true)}>Đã đọc</button>
              <button class="ghost" onClick={() => doMarkRead(selectedItems, false)}>Chưa đọc</button>
              <button class="ghost" onClick={() => removeWithUndo(selectedItems, 'archive')}>Archive</button>
              <button class="ghost danger" onClick={() => removeWithUndo(selectedItems, 'trash')}>Xoá</button>
            </>
          ) : (
            <span class="small muted">{query ? `Kết quả cho "${query}"` : 'Hộp thư đến'}</span>
          )}
        </div>

        {errors.map((e) => (
          <div class="banner small" key={e}>
            {e}
          </div>
        ))}

        <ul class="mail-list" role="list">
          {items.map((it) => {
            const acc = byId.get(it.accountId);
            return (
              <li key={it.key} class={`mail-row${it.unread ? ' unread' : ''}${selected.has(it.key) ? ' selected' : ''}`}>
                <input type="checkbox" aria-label="Chọn" checked={selected.has(it.key)} onChange={() => toggle(it.key)} />
                <button class="mail-main" onClick={() => setOpen({ accountId: it.accountId, id: it.id })}>
                  <div class="row">
                    {multi && acc && <span class="dot" style={{ background: acc.color }} title={acc.email} />}
                    <span class="grow ellipsis from">{displayName(it.from) || '(không rõ)'}</span>
                    <span class="small muted time">{formatTime(it.date)}</span>
                  </div>
                  <div class="ellipsis subject">{it.subject || '(không tiêu đề)'}</div>
                  <div class="ellipsis small muted">{it.snippet}</div>
                </button>
                <div class="row-actions">
                  <button class="ghost icon" title={it.unread ? 'Đánh dấu đã đọc' : 'Đánh dấu chưa đọc'} onClick={() => doMarkRead([it], it.unread)}>
                    {it.unread ? '◉' : '○'}
                  </button>
                  <button class="ghost icon" title="Archive" onClick={() => removeWithUndo([it], 'archive')}>
                    ⤓
                  </button>
                  <button class="ghost icon danger" title="Xoá (chuyển vào Thùng rác)" onClick={() => removeWithUndo([it], 'trash')}>
                    ✕
                  </button>
                  <a class="btn ghost icon" title="Mở trên Gmail" href={acc ? gmailWebUrl(acc.email, it.id) : '#'} target="_blank" rel="noopener noreferrer">
                    ↗
                  </a>
                </div>
              </li>
            );
          })}
        </ul>

        {loading && (
          <div class="row center">
            <Spinner />
          </div>
        )}
        {!loading && items.length === 0 && <p class="muted center">{query ? 'Không tìm thấy thư nào.' : 'Hộp thư đến trống.'}</p>}
        {!loading && hasMore && (
          <button class="load-more" onClick={() => void load(false)}>
            Tải thêm
          </button>
        )}
      </div>
    </div>
  );
}
