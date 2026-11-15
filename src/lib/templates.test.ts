import { describe, expect, it } from 'vitest';
import { applyVariables, exportTemplates, extractVariables, missingVariables, parseTemplateImport } from './templates';

describe('templates', () => {
  it('tìm biến, kể cả tiếng Việt và khoảng trắng', () => {
    expect(extractVariables('Chào {{name}}', '{{ công_ty }} - {{date}} {{name}}')).toEqual(['name', 'công_ty', 'date']);
  });

  it('thay biến, giữ nguyên biến chưa có giá trị, escape khi cần', () => {
    expect(applyVariables('Hi {{name}}, {{x}}', { name: 'A<b>' })).toBe('Hi A<b>, {{x}}');
    expect(applyVariables('Hi {{name}}', { name: 'A<b>' }, (s) => s.replace(/</g, '&lt;'))).toBe('Hi A&lt;b>');
  });

  it('biến thiếu = chưa có hoặc rỗng', () => {
    expect(missingVariables(['name', 'email', 'date', 'x'], { name: 'A', email: ' ', date: '1/1' })).toEqual(['email', 'x']);
  });

  it('export rồi import lại, lọc accountId không tồn tại', () => {
    const json = exportTemplates([
      { id: '1', name: 'T1', subject: 'S', body: '<b>x</b>', accountId: 'acc1' },
      { id: '2', name: 'T2', subject: '', body: '', accountId: 'gone' },
    ]);
    let n = 0;
    const out = parseTemplateImport(json, ['acc1'], (h) => h.toUpperCase(), () => `new${++n}`);
    expect(out).toEqual([
      { id: 'new1', name: 'T1', subject: 'S', body: '<B>X</B>', accountId: 'acc1' },
      { id: 'new2', name: 'T2', subject: '', body: '', accountId: undefined },
    ]);
  });

  it('báo lỗi file sai', () => {
    expect(() => parseTemplateImport('nope', [], (h) => h, () => 'x')).toThrow(/JSON/);
    expect(() => parseTemplateImport('{"a":1}', [], (h) => h, () => 'x')).toThrow(/templates/);
    expect(() => parseTemplateImport('[{"subject":"x"}]', [], (h) => h, () => 'x')).toThrow(/thiếu tên/);
  });
});
