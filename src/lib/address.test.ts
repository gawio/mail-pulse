import { describe, expect, it } from 'vitest';
import { formatAddress, parseAddress, parseAddressList, splitAddressList } from './address';

describe('address', () => {
  it('tách danh sách, bỏ qua dấu phẩy trong ngoặc kép', () => {
    expect(splitAddressList('"Lê, An" <an@x.vn>, b@y.com; c@z.com')).toEqual(['"Lê, An" <an@x.vn>', 'b@y.com', 'c@z.com']);
  });
  it('phân tích tên và email', () => {
    expect(parseAddress('"Lê, An" <an@x.vn>')).toEqual({ name: 'Lê, An', email: 'an@x.vn' });
    expect(parseAddress('b@y.com')).toEqual({ name: '', email: 'b@y.com' });
  });
  it('lọc địa chỉ không hợp lệ', () => {
    expect(parseAddressList('abc, d@e.f')).toEqual([{ name: '', email: 'd@e.f' }]);
  });
  it('định dạng lại có quote khi cần', () => {
    expect(formatAddress({ name: 'Lê, An', email: 'an@x.vn' })).toBe('"Lê, An" <an@x.vn>');
    expect(formatAddress({ name: 'An', email: 'an@x.vn' })).toBe('An <an@x.vn>');
  });
});
