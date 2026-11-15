// Sinh icon PNG đơn giản (không cần thư viện): hình tròn màu nhấn với một "nhịp" trắng.
// Chạy một lần: node scripts/gen-icons.mjs — kết quả đã được commit trong public/icons.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function icon(size) {
  const accent = [0x3b, 0x6f, 0xe0];
  const rows = [];
  const r = size / 2;
  // Đường "pulse": phẳng - lên - xuống - phẳng
  const pulseY = (x) => {
    const t = x / size;
    if (t < 0.3 || t > 0.72) return 0.5;
    if (t < 0.42) return 0.5 - ((t - 0.3) / 0.12) * 0.28;
    if (t < 0.58) return 0.22 + ((t - 0.42) / 0.16) * 0.52;
    return 0.74 - ((t - 0.58) / 0.14) * 0.24;
  };
  const stroke = Math.max(1, size * 0.07);
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - r, dy = y + 0.5 - r;
      const d = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.max(0, Math.min(1, r - d));
      let px = [...accent];
      const inPulse = x > size * 0.18 && x < size * 0.82 && Math.abs(y + 0.5 - pulseY(x + 0.5) * size) < stroke;
      if (inPulse) px = [255, 255, 255];
      row.push(...px, Math.round(alpha * 255));
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(new URL(`${s}.png`, out), icon(s));
console.log('Đã tạo public/icons/{16,32,48,128}.png');
