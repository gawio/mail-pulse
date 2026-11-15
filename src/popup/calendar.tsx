import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  eventEnd,
  eventStart,
  insertEvent,
  isAllDay,
  listCalendars,
  listEvents,
  meetLink,
  type CalendarEntry,
  type CalEvent,
} from '../lib/calendar-client';
import { isReauthError } from '../lib/auth';
import { htmlToText } from '../lib/mail-parse';
import type { Account } from '../lib/storage';
import { errorText, Spinner, type ToastState } from '../shared/components';
import { sendToBackground } from '../shared/messages';

interface Item {
  key: string;
  account: Account;
  calendar: CalendarEntry;
  ev: CalEvent;
  start: Date;
  end: Date;
  allDay: boolean;
}

interface Props {
  accounts: Account[];
  showToast: (t: ToastState | null) => void;
}

const DAYS = 8; // hôm nay + 7 ngày tới

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

const fmtTime = (d: Date) => d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

function dayLabel(d: Date, today: Date): string {
  const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / 86_400_000);
  const base = d.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' });
  if (diff === 0) return `Hôm nay · ${base}`;
  if (diff === 1) return `Ngày mai · ${base}`;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function timeRange(it: Item): string {
  if (it.allDay) {
    const lastDay = addDays(it.end, -1);
    return lastDay.getTime() > it.start.getTime()
      ? `Cả ngày, ${it.start.toLocaleDateString('vi-VN')} – ${lastDay.toLocaleDateString('vi-VN')}`
      : `Cả ngày, ${it.start.toLocaleDateString('vi-VN')}`;
  }
  const sameDay = it.start.toDateString() === it.end.toDateString();
  return sameDay
    ? `${it.start.toLocaleDateString('vi-VN', { weekday: 'short', day: 'numeric', month: 'numeric' })}, ${fmtTime(it.start)} – ${fmtTime(it.end)}`
    : `${it.start.toLocaleString('vi-VN')} – ${it.end.toLocaleString('vi-VN')}`;
}

const STATUS: Record<string, string> = { accepted: '✓', declined: '✗', tentative: '?', needsAction: '·' };
const STATUS_TEXT: Record<string, string> = { accepted: 'Đồng ý', declined: 'Từ chối', tentative: 'Có thể', needsAction: 'Chưa trả lời' };

export function CalendarView({ accounts, showToast }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [calendars, setCalendars] = useState<{ account: Account; cal: CalendarEntry }[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);
  const accountKey = accounts.map((a) => a.id).join(',');
  const today = startOfDay(new Date());

  const load = async () => {
    setLoading(true);
    const from = startOfDay(new Date());
    const to = addDays(from, DAYS);
    const errs: string[] = [];
    const cals: { account: Account; cal: CalendarEntry }[] = [];
    const results = await Promise.all(
      accounts
        .filter((a) => !a.needsReauth)
        .map(async (account) => {
          try {
            const list = await listCalendars(account.id, account.email);
            cals.push(...list.map((cal) => ({ account, cal })));
            const perCal = await Promise.all(
              list.map(async (cal) =>
                (await listEvents(account.id, cal.id, from, to)).map<Item>((ev) => ({
                  key: `${account.id}:${cal.id}:${ev.id}`,
                  account,
                  calendar: cal,
                  ev,
                  start: eventStart(ev),
                  end: eventEnd(ev),
                  allDay: isAllDay(ev),
                })),
              ),
            );
            return perCal.flat();
          } catch (e) {
            if (!isReauthError(e)) errs.push(`${account.email}: ${errorText(e)}`);
            return [];
          }
        }),
    );
    // Cùng một sự kiện có thể xuất hiện ở nhiều lịch/tài khoản — bỏ trùng theo iCalUID-ish (id + giờ).
    const seen = new Set<string>();
    const merged = results
      .flat()
      .filter((it) => {
        const k = `${it.ev.id}|${it.start.getTime()}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
    setItems(merged);
    setCalendars(cals.filter((c) => c.cal.accessRole === 'owner' || c.cal.accessRole === 'writer'));
    setErrors(errs);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 5 * 60_000);
    return () => window.clearInterval(t);
  }, [accountKey]);

  const days = useMemo(
    () =>
      Array.from({ length: DAYS }, (_, i) => {
        const start = addDays(today, i);
        const end = addDays(today, i + 1);
        return { start, items: items.filter((it) => it.start < end && it.end > start) };
      }),
    [items, today.getTime()],
  );

  if (selected) return <EventDetail item={selected} onBack={() => setSelected(null)} />;

  return (
    <div class="calendar col">
      <div class="row toolbar">
        <button class="primary" onClick={() => setCreating((c) => !c)} aria-expanded={creating}>
          + Sự kiện
        </button>
        <span class="spacer" />
        <button class="ghost icon" title="Làm mới" onClick={() => void load()} disabled={loading}>
          ↻
        </button>
      </div>
      {creating && (
        <QuickCreate
          calendars={calendars}
          onCancel={() => setCreating(false)}
          onCreated={(ev, acc) => {
            setCreating(false);
            showToast({ text: `Đã tạo "${ev.summary}" trong ${acc.email}`, ms: 3000 });
            void load();
            void sendToBackground({ type: 'calendar-sync' });
          }}
        />
      )}
      {errors.map((e) => (
        <div class="banner small" key={e}>
          {e}
        </div>
      ))}
      {loading && items.length === 0 && (
        <div class="row center">
          <Spinner />
        </div>
      )}
      {days.map((d) => (
        <section class="cal-day" key={d.start.getTime()}>
          <h3 class={d.start.getTime() === today.getTime() ? 'today' : ''}>{dayLabel(d.start, today)}</h3>
          {d.items.length === 0 && <div class="muted small cal-empty">Không có sự kiện</div>}
          {d.items.map((it) => (
            <button key={it.key + d.start.getTime()} class="cal-event" style={{ borderLeftColor: it.account.color }} onClick={() => setSelected(it)}>
              <span class="cal-time small muted">{it.allDay ? 'Cả ngày' : `${fmtTime(it.start)} – ${fmtTime(it.end)}`}</span>
              <span class="ellipsis cal-title">{it.ev.summary || '(Không tiêu đề)'}</span>
              {meetLink(it.ev) && <span class="small muted">Meet</span>}
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

function EventDetail({ item, onBack }: { item: Item; onBack: () => void }) {
  const ev = item.ev;
  const meet = meetLink(ev);
  const description = useMemo(() => (ev.description ? htmlToText(ev.description) : ''), [ev.description]);
  return (
    <div class="col event-detail">
      <div class="row toolbar">
        <button class="ghost" onClick={onBack}>
          ← Quay lại
        </button>
        <span class="spacer" />
        {ev.htmlLink && (
          <a class="btn ghost" href={ev.htmlLink} target="_blank" rel="noopener noreferrer">
            Mở trên Google Calendar ↗
          </a>
        )}
      </div>
      <div class="col detail-body">
        <h2>{ev.summary || '(Không tiêu đề)'}</h2>
        <div>{timeRange(item)}</div>
        <div class="row small muted">
          <span class="dot" style={{ background: item.account.color }} />
          {item.calendar.summary} · {item.account.email}
        </div>
        {ev.location && (
          <div>
            <span class="muted">Địa điểm: </span>
            {ev.location}
          </div>
        )}
        {meet && (
          <div>
            <a class="btn primary meet-btn" href={meet} target="_blank" rel="noopener noreferrer">
              Tham gia Google Meet
            </a>
            <div class="small muted">{meet}</div>
          </div>
        )}
        {ev.attendees && ev.attendees.length > 0 && (
          <div class="col attendees">
            <h3>Người tham dự ({ev.attendees.length})</h3>
            {ev.attendees.map((a) => (
              <div class="row small" key={a.email} title={STATUS_TEXT[a.responseStatus ?? 'needsAction']}>
                <span class={`att-status ${a.responseStatus ?? ''}`}>{STATUS[a.responseStatus ?? 'needsAction']}</span>
                <span class="ellipsis grow">
                  {a.displayName ? `${a.displayName} <${a.email}>` : a.email}
                  {a.organizer ? ' · tổ chức' : ''}
                  {a.optional ? ' · không bắt buộc' : ''}
                </span>
              </div>
            ))}
          </div>
        )}
        {description && <div class="description">{description}</div>}
      </div>
    </div>
  );
}

function QuickCreate({
  calendars,
  onCancel,
  onCreated,
}: {
  calendars: { account: Account; cal: CalendarEntry }[];
  onCancel: () => void;
  onCreated: (ev: CalEvent, acc: Account) => void;
}) {
  const nextHour = new Date();
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(toLocalInput(nextHour));
  const [end, setEnd] = useState(toLocalInput(new Date(nextHour.getTime() + 30 * 60_000)));
  const defaultTarget = calendars.find((c) => c.cal.primary) ?? calendars[0];
  const [target, setTarget] = useState(defaultTarget ? `${defaultTarget.account.id}|${defaultTarget.cal.id}` : '');
  const [withMeet, setWithMeet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: Event) => {
    e.preventDefault();
    setError('');
    const s = new Date(start);
    const en = new Date(end);
    if (!title.trim()) return setError('Cần tiêu đề.');
    if (!(en > s)) return setError('Thời gian kết thúc phải sau thời gian bắt đầu.');
    const sel = calendars.find((c) => `${c.account.id}|${c.cal.id}` === target);
    if (!sel) return setError('Chọn lịch.');
    setBusy(true);
    try {
      const ev = await insertEvent(sel.account.id, sel.cal.id, { summary: title.trim(), start: s, end: en, withMeet });
      onCreated(ev, sel.account);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="card col quick-create" onSubmit={submit}>
      <input placeholder="Tiêu đề sự kiện" value={title} autoFocus onInput={(e) => setTitle(e.currentTarget.value)} />
      <div class="row wrap">
        <label class="col small">
          Bắt đầu
          <input
            type="datetime-local"
            value={start}
            onInput={(e) => {
              const v = e.currentTarget.value;
              // Giữ nguyên thời lượng khi đổi giờ bắt đầu.
              const dur = new Date(end).getTime() - new Date(start).getTime();
              setStart(v);
              if (dur > 0 && v) setEnd(toLocalInput(new Date(new Date(v).getTime() + dur)));
            }}
          />
        </label>
        <label class="col small">
          Kết thúc
          <input type="datetime-local" value={end} onInput={(e) => setEnd(e.currentTarget.value)} />
        </label>
      </div>
      <select value={target} onChange={(e) => setTarget(e.currentTarget.value)} aria-label="Lịch">
        {calendars.map((c) => (
          <option key={`${c.account.id}|${c.cal.id}`} value={`${c.account.id}|${c.cal.id}`}>
            {c.account.email} — {c.cal.summary}
          </option>
        ))}
      </select>
      <label>
        <input type="checkbox" checked={withMeet} onChange={(e) => setWithMeet(e.currentTarget.checked)} />
        Thêm Google Meet
      </label>
      {error && <div class="error small">{error}</div>}
      <div class="row">
        <button type="submit" class="primary" disabled={busy}>
          {busy ? 'Đang tạo…' : 'Tạo'}
        </button>
        <button type="button" onClick={onCancel}>
          Huỷ
        </button>
      </div>
    </form>
  );
}
