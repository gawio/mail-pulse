import { patchAccount, updateLocal, type PollSeconds, type Settings } from '../lib/storage';
import { useLocal } from '../shared/components';

export function saveSettings(patch: Partial<Settings>): Promise<unknown> {
  return updateLocal('settings', (s) => ({ ...s, ...patch }));
}

const INTERVALS: { value: PollSeconds; label: string }[] = [
  { value: 5, label: '5 giây' },
  { value: 10, label: '10 giây (mặc định)' },
  { value: 15, label: '15 giây' },
  { value: 30, label: '30 giây' },
  { value: 60, label: '1 phút' },
  { value: 300, label: '5 phút' },
];

export function NotificationsSection() {
  const settings = useLocal('settings');
  const accounts = useLocal('accounts');
  if (!settings || !accounts) return null;
  return (
    <section class="col">
      <h2>Thông báo & đồng bộ</h2>
      <p class="muted small">
        Số thư chưa đọc trong Hộp thư đến (cộng tất cả tài khoản) luôn hiện trên icon Mail Pulse, giống số thông báo của YouTube.
      </p>
      <div class="field">
        <span>Kiểm tra thư mới mỗi</span>
        <select
          value={String(settings.pollIntervalSec)}
          onChange={(e) => saveSettings({ pollIntervalSec: Number(e.currentTarget.value) as PollSeconds })}
        >
          {INTERVALS.map((i) => (
            <option key={i.value} value={String(i.value)}>
              {i.label}
            </option>
          ))}
        </select>
      </div>
      <div class="field">
        <span>Popup của trình duyệt</span>
        <label>
          <input type="checkbox" checked={settings.mailNotifications} onChange={(e) => saveSettings({ mailNotifications: e.currentTarget.checked })} />
          Hiện popup thông báo khi có thư mới
        </label>
      </div>
      {settings.mailNotifications && (
        <>
          <div class="field">
            <span>Không báo popup cho</span>
            <div class="col">
              <label>
                <input type="checkbox" checked={settings.skipPromotions} onChange={(e) => saveSettings({ skipPromotions: e.currentTarget.checked })} />
                Quảng cáo (Promotions)
              </label>
              <label>
                <input type="checkbox" checked={settings.skipSocial} onChange={(e) => saveSettings({ skipSocial: e.currentTarget.checked })} />
                Mạng xã hội (Social)
              </label>
            </div>
          </div>
          <div class="field">
            <span>Popup theo tài khoản</span>
            <div class="col">
              {accounts.length === 0 && <span class="muted">Chưa có tài khoản.</span>}
              {accounts.map((a) => (
                <label key={a.id}>
                  <input type="checkbox" checked={a.notify} onChange={(e) => patchAccount(a.id, { notify: e.currentTarget.checked })} />
                  {a.email}
                </label>
              ))}
            </div>
          </div>
        </>
      )}
      <div class="field">
        <span>Nhắc trước sự kiện lịch</span>
        <select value={String(settings.reminderMinutes)} onChange={(e) => saveSettings({ reminderMinutes: Number(e.currentTarget.value) })}>
          <option value="0">Tắt</option>
          {[1, 5, 10, 15, 30, 60].map((m) => (
            <option key={m} value={String(m)}>
              {m} phút
            </option>
          ))}
        </select>
      </div>
      <p class="muted small">
        Mỗi lần kiểm tra chỉ tốn 1 request nhỏ cho mỗi tài khoản; số chưa đọc chỉ được tải lại khi hộp thư có thay đổi. Khi bạn quay lại cửa sổ
        trình duyệt, Mail Pulse kiểm tra ngay. Nhắc sự kiện lịch dùng popup của trình duyệt — chọn "Tắt" nếu không cần.
      </p>
    </section>
  );
}
