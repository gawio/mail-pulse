import { useState } from 'preact/hooks';
import { addAccount, oauthRedirectUri, reauthInteractive, removeAccount } from '../lib/auth';
import { Avatar, errorText, useLocal } from '../shared/components';
import { sendToBackground } from '../shared/messages';
import { IS_FIREFOX } from '../lib/ext';

export function AccountsSection() {
  const accounts = useLocal('accounts');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError('');
    try {
      await fn();
      await sendToBackground({ type: 'poll-now' });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section class="col">
      <h2>Tài khoản</h2>
      <p class="muted small">
        Mail Pulse giữ refresh token của mỗi tài khoản trên máy (storage.local) để tự lấy token mới, không cần đăng nhập lại.
        Chỉ khi Google thu hồi quyền (bạn gỡ quyền, đổi mật khẩu…) tài khoản mới được đánh dấu "Cần đăng nhập lại".
      </p>
      {error && <div class="banner">{error}</div>}
      {accounts?.length === 0 && <p class="muted">Chưa có tài khoản nào.</p>}
      {accounts?.map((a) => (
        <div class="card row" key={a.id}>
          <Avatar account={a} size={36} />
          <div class="grow">
            <div class="ellipsis">
              <strong>{a.name}</strong>
            </div>
            <div class="muted small ellipsis">{a.email}</div>
            {a.needsReauth && <div class="error small">Cần đăng nhập lại</div>}
          </div>
          <span class="dot" style={{ background: a.color }} title="Màu tài khoản" />
          {a.needsReauth && (
            <button class="primary" disabled={!!busy} onClick={() => run(`re:${a.id}`, () => reauthInteractive(a.id))}>
              {busy === `re:${a.id}` ? '…' : 'Đăng nhập lại'}
            </button>
          )}
          <button
            class="danger"
            disabled={!!busy}
            onClick={() => {
              if (confirm(`Xoá tài khoản ${a.email} khỏi Mail Pulse?`)) void run(`rm:${a.id}`, () => removeAccount(a.id));
            }}
          >
            Xoá
          </button>
        </div>
      ))}
      <div>
        <button class="primary" disabled={!!busy} onClick={() => run('add', addAccount)}>
          {busy === 'add' ? 'Đang mở đăng nhập…' : '+ Thêm tài khoản Google'}
        </button>
      </div>
      <p class="muted small">
        Xoá tài khoản sẽ thu hồi quyền truy cập của Mail Pulse và xoá mọi dữ liệu liên quan khỏi máy. Bạn cũng có thể thu hồi quyền tại
        myaccount.google.com/permissions.
      </p>
      <details class="card small">
        <summary>Thông tin cấu hình OAuth (Google Cloud)</summary>
        <p>
          Authorized redirect URI cần khai báo cho OAuth client ({IS_FIREFOX ? 'Firefox' : 'Chrome'}):
        </p>
        <code class="copyable">{oauthRedirectUri()}</code>
      </details>
    </section>
  );
}
