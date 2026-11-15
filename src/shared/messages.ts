/** Message giữa các trang extension và service worker. */
import { ext } from '../lib/ext';
export type RuntimeMessage =
  | { type: 'poll-now' }
  | { type: 'refresh-badge' }
  | { type: 'calendar-sync' }
  | { type: 'open-compose'; params: Record<string, string> }
  | { type: 'open-settings' };

export function sendToBackground(msg: RuntimeMessage): Promise<unknown> {
  return ext.runtime.sendMessage(msg).catch(() => undefined);
}

export function openSettings(section?: string): void {
  const url = ext.runtime.getURL(`settings/index.html${section ? `#${section}` : ''}`);
  void ext.tabs.create({ url });
}

/** Mở cửa sổ soạn mail dạng popup. params: mode=new|reply|replyAll|forward, account, id, to, template… */
export function openCompose(params: Record<string, string> = {}): void {
  const qs = new URLSearchParams(params).toString();
  void ext.windows.create({
    url: ext.runtime.getURL(`compose/index.html${qs ? `?${qs}` : ''}`),
    type: 'popup',
    width: 760,
    height: 780,
  });
}
