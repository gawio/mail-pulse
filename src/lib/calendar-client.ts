/** Google Calendar API v3 client. Mọi hàm nhận accountId đầu tiên. */
import { ApiError, apiJson, jsonBody, withQuery } from './http';

const BASE = 'https://www.googleapis.com/calendar/v3';

export interface CalendarEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: 'freeBusyReader' | 'reader' | 'writer' | 'owner';
  backgroundColor?: string;
  selected?: boolean;
  hidden?: boolean;
}

export interface EventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface Attendee {
  email: string;
  displayName?: string;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  self?: boolean;
  organizer?: boolean;
  optional?: boolean;
}

export interface CalEvent {
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  start: EventTime;
  end: EventTime;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string; label?: string }[] };
  attendees?: Attendee[];
  organizer?: { email?: string; displayName?: string; self?: boolean };
}

/**
 * Danh sách lịch hiển thị của tài khoản. Nếu không đọc được (thiếu quyền calendarlist),
 * dùng lịch chính 'primary'.
 */
export async function listCalendars(acc: string, fallbackName: string): Promise<CalendarEntry[]> {
  try {
    const r = await apiJson<{ items?: CalendarEntry[] }>(acc, withQuery(`${BASE}/users/me/calendarList`, { maxResults: 250 }));
    return (r.items ?? []).filter((c) => !c.hidden && c.selected !== false && c.accessRole !== 'freeBusyReader');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return [{ id: 'primary', summary: fallbackName, primary: true, accessRole: 'owner' }];
    throw e;
  }
}

export async function listEvents(acc: string, calendarId: string, timeMin: Date, timeMax: Date): Promise<CalEvent[]> {
  const out: CalEvent[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const r = await apiJson<{ items?: CalEvent[]; nextPageToken?: string }>(
      acc,
      withQuery(`${BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
        singleEvents: true,
        orderBy: 'startTime',
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: 250,
        pageToken,
      }),
    );
    out.push(...(r.items ?? []));
    pageToken = r.nextPageToken;
  } while (pageToken && ++pages < 5);
  return out.filter((e) => e.status !== 'cancelled');
}

export const getEvent = (acc: string, calendarId: string, eventId: string) =>
  apiJson<CalEvent>(acc, `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);

export interface NewEvent {
  summary: string;
  start: Date;
  end: Date;
  withMeet: boolean;
}

export function insertEvent(acc: string, calendarId: string, ev: NewEvent): Promise<CalEvent> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body: Record<string, unknown> = {
    summary: ev.summary,
    start: { dateTime: ev.start.toISOString(), timeZone },
    end: { dateTime: ev.end.toISOString(), timeZone },
  };
  if (ev.withMeet) {
    body.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  }
  return apiJson<CalEvent>(
    acc,
    withQuery(`${BASE}/calendars/${encodeURIComponent(calendarId)}/events`, { conferenceDataVersion: ev.withMeet ? 1 : undefined }),
    { method: 'POST', ...jsonBody(body) },
  );
}

// ---- Tiện ích ----

export function eventStart(e: CalEvent): Date {
  return e.start.dateTime ? new Date(e.start.dateTime) : localDate(e.start.date ?? '');
}

export function eventEnd(e: CalEvent): Date {
  return e.end.dateTime ? new Date(e.end.dateTime) : localDate(e.end.date ?? '');
}

export function isAllDay(e: CalEvent): boolean {
  return !e.start.dateTime && !!e.start.date;
}

/** 'YYYY-MM-DD' -> Date lúc 00:00 giờ địa phương. */
function localDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function meetLink(e: CalEvent): string | undefined {
  return e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri;
}

export function selfDeclined(e: CalEvent): boolean {
  return e.attendees?.some((a) => a.self && a.responseStatus === 'declined') ?? false;
}
