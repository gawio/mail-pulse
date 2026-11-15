/**
 * Lưu nháp khi cửa sổ soạn thư đóng: trang compose gửi raw MIME qua Port tới service worker
 * ngay trong sự kiện pagehide; service worker thực hiện drafts.create/update.
 */
import { createDraft, updateDraft } from '../lib/gmail-client';
import { ext } from '../lib/ext';

export interface DraftPortMessage {
  type: 'save-draft';
  accountId: string;
  draftId?: string;
  threadId?: string;
  raw: string;
}

export function registerDraftPort(): void {
  ext.runtime.onConnect.addListener((port) => {
    if (port.name !== 'compose' || port.sender?.id !== ext.runtime.id) return;
    port.onMessage.addListener((msg: DraftPortMessage) => {
      if (msg?.type !== 'save-draft' || typeof msg.raw !== 'string') return;
      const p = msg.draftId ? updateDraft(msg.accountId, msg.draftId, msg.raw, msg.threadId) : createDraft(msg.accountId, msg.raw, msg.threadId);
      p.catch((e: unknown) => console.warn('[draft] lưu nháp khi đóng cửa sổ thất bại:', e));
    });
  });
}
