// Tạo cặp khoá RSA để cố định extension ID (trường "key" trong manifest).
// Ghi EXTENSION_KEY vào .env, private key vào key.pem (gitignored, chỉ cần nếu muốn đóng gói .crx).
import { generateKeyPairSync, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const envPath = new URL('../.env', import.meta.url);
const pemPath = new URL('../key.pem', import.meta.url);

let env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const existing = env.match(/^EXTENSION_KEY=(.+)$/m)?.[1]?.trim();

let pubDer;
if (existing && !process.argv.includes('--force')) {
  pubDer = Buffer.from(existing, 'base64');
  console.log('EXTENSION_KEY đã có trong .env (dùng --force để tạo mới).');
} else {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  pubDer = publicKey;
  writeFileSync(pemPath, privateKey, { mode: 0o600 });
  const line = `EXTENSION_KEY=${publicKey.toString('base64')}`;
  env = /^EXTENSION_KEY=.*$/m.test(env) ? env.replace(/^EXTENSION_KEY=.*$/m, line) : `${env.trimEnd()}\n${line}\n`.trimStart();
  writeFileSync(envPath, env);
  console.log('Đã ghi EXTENSION_KEY vào .env và private key vào key.pem');
}

// Extension ID = 32 ký tự đầu của SHA-256(public key DER), map 0-f -> a-p.
const id = [...createHash('sha256').update(pubDer).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join('');
console.log(`\nExtension ID:  ${id}`);
console.log(`Redirect URI:  https://${id}.chromiumapp.org/`);
