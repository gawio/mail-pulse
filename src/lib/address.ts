/** Phân tích header địa chỉ email (RFC 5322, đủ dùng cho hiển thị và trả lời). */
export interface Address {
  name: string;
  email: string;
}

/** Tách danh sách địa chỉ theo dấu phẩy, bỏ qua dấu phẩy trong "..." hoặc <...>. */
export function splitAddressList(value: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let angle = 0;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '<') angle++;
    else if (!quoted && ch === '>') angle = Math.max(0, angle - 1);
    if ((ch === ',' || ch === ';') && !quoted && angle === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseAddress(raw: string): Address {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw);
  if (m) {
    const name = (m[1] ?? '').replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"').trim();
    return { name, email: (m[2] ?? '').trim() };
  }
  return { name: '', email: raw.trim() };
}

export function parseAddressList(value: string): Address[] {
  return splitAddressList(value).map(parseAddress).filter((a) => a.email.includes('@'));
}

export function displayName(raw: string): string {
  const a = parseAddress(raw);
  return a.name || a.email;
}

export function formatAddress(a: Address): string {
  if (!a.name) return a.email;
  const needsQuote = /[",.;:<>@()[\]\\]/.test(a.name);
  return needsQuote ? `"${a.name.replace(/(["\\])/g, '\\$1')}" <${a.email}>` : `${a.name} <${a.email}>`;
}

export function isValidEmail(e: string): boolean {
  return /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(e);
}
