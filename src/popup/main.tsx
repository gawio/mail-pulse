import { render } from 'preact';
import { useState } from 'preact/hooks';
import '../shared/base.css';
import './popup.css';
import { Avatar, Toast, useLocal, useToast } from '../shared/components';
import { openCompose, openSettings } from '../shared/messages';
import { initTheme } from '../shared/theme';
import { CalendarView } from './calendar';
import { Inbox } from './inbox';

type Tab = 'mail' | 'calendar';

function App() {
  const accounts = useLocal('accounts');
  const [scope, setScope] = useState<string>('all');
  const [tab, setTab] = useState<Tab>('mail');
  const [toast, showToast] = useToast();

  if (!accounts) return null;

  if (accounts.length === 0) {
    return (
      <div class="empty col center">
        <h2>Mail Pulse</h2>
        <p class="muted">Thêm tài khoản Google để bắt đầu.</p>
        <button class="primary" onClick={() => openSettings('accounts')}>
          Mở Cài đặt
        </button>
      </div>
    );
  }

  const active = scope === 'all' ? accounts : accounts.filter((a) => a.id === scope);
  const effective = active.length ? active : accounts;
  const needReauth = accounts.filter((a) => a.needsReauth);

  return (
    <div class="app">
      <header class="row account-bar">
        <button class="acc-chip" aria-pressed={scope === 'all'} onClick={() => setScope('all')} title="Tất cả tài khoản">
          Tất cả
        </button>
        {accounts.map((a) => (
          <button key={a.id} class="acc-chip avatar-chip" aria-pressed={scope === a.id} onClick={() => setScope(a.id)} title={a.email}>
            <Avatar account={a} size={22} />
            {a.needsReauth && <span class="reauth-dot" />}
          </button>
        ))}
        <span class="spacer" />
        <button
          class="primary"
          onClick={() => openCompose({ mode: 'new', ...(scope !== 'all' ? { account: scope } : {}) })}
          title="Soạn thư mới"
        >
          Soạn
        </button>
        <button class="ghost icon" title="Cài đặt" onClick={() => openSettings()}>
          ⚙
        </button>
      </header>

      {needReauth.map((a) => (
        <div class="banner row small" key={a.id}>
          <span class="grow ellipsis">{a.email} cần đăng nhập lại.</span>
          {/* Popup tự đóng khi cửa sổ đăng nhập Google lấy focus -> chạy đăng nhập ở trang Cài đặt. */}
          <button onClick={() => openSettings('accounts')}>Đăng nhập</button>
        </div>
      ))}

      <nav class="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'mail'} onClick={() => setTab('mail')}>
          Hộp thư
        </button>
        <button role="tab" aria-selected={tab === 'calendar'} onClick={() => setTab('calendar')}>
          Lịch
        </button>
      </nav>

      <main class="content">
        {tab === 'mail' && <Inbox accounts={effective} allAccounts={accounts} showToast={showToast} />}
        {tab === 'calendar' && <CalendarView accounts={effective} showToast={showToast} />}
      </main>
      <Toast toast={toast} onClose={() => showToast(null)} />
    </div>
  );
}

// Mở trong tab (vd. từ thông báo trên Firefox) thay vì popup -> bố cục rộng hơn, không cố định kích thước.
document.documentElement.classList.toggle('in-tab', new URLSearchParams(location.search).has('tab'));
void initTheme();
render(<App />, document.getElementById('app')!);
