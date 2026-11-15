/** Logic template: biến {{...}}, thay thế, import/export JSON. Không phụ thuộc DOM (test được trong Node). */
import type { Template } from './storage';

export const BUILTIN_VARS = ['name', 'email', 'date'] as const;
const VAR_RE = /\{\{\s*([\p{L}\p{N}_.-]+)\s*\}\}/gu;

export function extractVariables(...texts: string[]): string[] {
  const out: string[] = [];
  for (const t of texts) for (const m of t.matchAll(VAR_RE)) if (m[1] && !out.includes(m[1])) out.push(m[1]);
  return out;
}

export function applyVariables(text: string, values: Record<string, string>, escape?: (s: string) => string): string {
  return text.replace(VAR_RE, (whole, name: string) => {
    const v = values[name];
    if (v === undefined) return whole;
    return escape ? escape(v) : v;
  });
}

/** Các biến còn thiếu giá trị (biến tự định nghĩa luôn cần hỏi; biến dựng sẵn chỉ hỏi khi trống). */
export function missingVariables(vars: string[], known: Record<string, string>): string[] {
  return vars.filter((v) => !known[v]?.trim());
}

export function formatToday(d = new Date()): string {
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export interface TemplateExport {
  app: 'mail-pulse';
  version: 1;
  exportedAt: string;
  templates: Omit<Template, 'id'>[];
}

export function exportTemplates(list: Template[], now = new Date()): string {
  const data: TemplateExport = {
    app: 'mail-pulse',
    version: 1,
    exportedAt: now.toISOString(),
    templates: list.map(({ name, subject, body, accountId }) => ({ name, subject, body, ...(accountId ? { accountId } : {}) })),
  };
  return JSON.stringify(data, null, 2);
}

const MAX_IMPORT = 500;
const MAX_FIELD = 200_000;

/**
 * Đọc file JSON template. Chấp nhận định dạng export hoặc mảng thô.
 * `cleanBody` lọc HTML (whitelist) — truyền vào từ trang có DOM.
 */
export function parseTemplateImport(json: string, validAccountIds: string[], cleanBody: (html: string) => string, newId: () => string): Template[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('File không phải JSON hợp lệ.');
  }
  const arr = Array.isArray(data) ? data : (data as { templates?: unknown } | null)?.templates;
  if (!Array.isArray(arr)) throw new Error('Không tìm thấy danh sách templates trong file.');
  if (arr.length > MAX_IMPORT) throw new Error(`Tối đa ${MAX_IMPORT} template mỗi lần import.`);
  return arr.map((raw, i) => {
    const t = raw as Partial<Record<keyof Template, unknown>>;
    if (typeof t.name !== 'string' || !t.name.trim()) throw new Error(`Template #${i + 1} thiếu tên.`);
    const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_FIELD) : '');
    const accountId = typeof t.accountId === 'string' && validAccountIds.includes(t.accountId) ? t.accountId : undefined;
    return { id: newId(), name: t.name.trim().slice(0, 200), subject: str(t.subject), body: cleanBody(str(t.body)), accountId };
  });
}
