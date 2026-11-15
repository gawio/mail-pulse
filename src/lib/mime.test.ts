import { describe, expect, it } from 'vitest';
import { buildMime, encodeHeaderWord, replySubject, toBase64Url, utf8ToBase64, wrap76 } from './mime';

const decodeWords = (h: string) =>
  h.replace(/\r\n /g, '').replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));

describe('mime', () => {
  it('giữ nguyên header ASCII, mã hoá RFC 2047 khi có dấu', () => {
    expect(encodeHeaderWord('Hello')).toBe('Hello');
    const enc = encodeHeaderWord('Xin chào các bạn, đây là một tiêu đề khá dài để kiểm tra việc tách từ');
    expect(enc).toMatch(/^=\?UTF-8\?B\?/);
    for (const line of enc.split('\r\n ')) expect(line.length).toBeLessThanOrEqual(75);
    expect(decodeWords(enc)).toBe('Xin chào các bạn, đây là một tiêu đề khá dài để kiểm tra việc tách từ');
  });

  it('chặn header injection', () => {
    expect(encodeHeaderWord('a\r\nBcc: evil@x.com')).toBe('a Bcc: evil@x.com');
  });

  it('wrap base64 76 ký tự', () => {
    const w = wrap76('A'.repeat(200));
    expect(w.split('\r\n').map((l) => l.length)).toEqual([76, 76, 48]);
  });

  it('tạo multipart/mixed với alternative + attachment', () => {
    const raw = buildMime({
      from: { name: 'Hậu', email: 'me@x.com' },
      to: [{ name: '', email: 'a@b.com' }],
      cc: [{ name: 'C', email: 'c@d.com' }],
      subject: 'Chào',
      text: 'xin chào',
      html: '<p>xin chào</p>',
      inReplyTo: '<id1@mail>',
      references: '<id0@mail> <id1@mail>',
      attachments: [{ filename: 'báo cáo.pdf', mimeType: 'application/pdf', base64: utf8ToBase64('PDF') }],
      boundarySeed: 'T',
      date: new Date('2026-01-02T03:04:05Z'),
    });
    expect(raw).toMatch(/^From: =\?UTF-8\?B\?[^?]+\?= <me@x\.com>\r\n/);
    expect(raw).toContain('To: a@b.com\r\n');
    expect(raw).toContain('Cc: C <c@d.com>\r\n');
    expect(raw).toContain('In-Reply-To: <id1@mail>\r\n');
    expect(raw).toContain('References: <id0@mail> <id1@mail>\r\n');
    expect(raw).toContain('Date: Fri, 02 Jan 2026 03:04:05 +0000\r\n');
    expect(raw).toContain('Content-Type: multipart/mixed; boundary="=_mp_T_1"');
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="=_mp_T_2"');
    expect(raw).toContain(`\r\n\r\n${utf8ToBase64('xin chào')}\r\n`);
    expect(raw).toContain("filename*=UTF-8''b%C3%A1o%20c%C3%A1o.pdf");
    expect(raw.trimEnd().endsWith('--=_mp_T_1--')).toBe(true);
    expect(/^[\x00-\x7f]*$/.test(raw)).toBe(true);
  });

  it('chế độ plain: chỉ text/plain, không multipart', () => {
    const raw = buildMime({ from: { name: '', email: 'me@x.com' }, to: [{ name: '', email: 'a@b.com' }], subject: 's', text: 't' });
    expect(raw).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(raw).not.toContain('multipart');
  });

  it('base64url không padding', () => {
    expect(toBase64Url('??>')).toBe('Pz8-');
  });

  it('tiền tố Re:/Fwd: không lặp', () => {
    expect(replySubject('Hello', 'reply')).toBe('Re: Hello');
    expect(replySubject('RE: Hello', 'reply')).toBe('RE: Hello');
    expect(replySubject('Hello', 'forward')).toBe('Fwd: Hello');
    expect(replySubject('Fw: Hello', 'forward')).toBe('Fw: Hello');
  });
});
