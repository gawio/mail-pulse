import { describe, expect, it } from 'vitest';
import type { GmailMessage } from './gmail-client';
import { base64UrlToBytes, parseMessage } from './mail-parse';

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

describe('mail-parse', () => {
  it('giải mã base64url không padding', () => {
    expect(new TextDecoder().decode(base64UrlToBytes(b64url('Xin chào ~?>')))).toBe('Xin chào ~?>');
  });

  it('tách html, text, file đính kèm và ảnh inline', () => {
    const msg: GmailMessage = {
      id: '1',
      threadId: '1',
      payload: {
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=UTF-8' }], body: { size: 5, data: b64url('chào') } },
              { mimeType: 'text/html', body: { size: 5, data: b64url('<b>chào</b>') } },
            ],
          },
          {
            mimeType: 'image/png',
            filename: '',
            headers: [{ name: 'Content-ID', value: '<logo@x>' }, { name: 'Content-Disposition', value: 'inline' }],
            body: { size: 10, attachmentId: 'img1' },
          },
          { partId: '3', mimeType: 'application/pdf', filename: 'a.pdf', body: { size: 1234, attachmentId: 'att1' } },
        ],
      },
    };
    const p = parseMessage(msg);
    expect(p.text).toBe('chào');
    expect(p.html).toBe('<b>chào</b>');
    expect(p.inline).toEqual([{ cid: 'logo@x', mimeType: 'image/png', attachmentId: 'img1', data: undefined }]);
    expect(p.attachments).toHaveLength(1);
    expect(p.attachments[0]).toMatchObject({ filename: 'a.pdf', size: 1234, attachmentId: 'att1' });
  });
});
