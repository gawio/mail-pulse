import type { ThemeMode } from '../lib/storage';
import { useLocal } from '../shared/components';
import { ACCENT_PRESETS } from '../shared/theme';
import { saveSettings } from './notifications';

const MODES: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Sáng' },
  { value: 'dark', label: 'Tối' },
  { value: 'system', label: 'Theo hệ thống' },
];

export function ThemeSection() {
  const settings = useLocal('settings');
  if (!settings) return null;
  return (
    <section class="col">
      <h2>Giao diện</h2>
      <div class="field">
        <span>Chế độ</span>
        <div class="row segmented-group" role="radiogroup" aria-label="Chế độ màu">
          {MODES.map((m) => (
            <button key={m.value} role="radio" aria-checked={settings.theme === m.value} aria-pressed={settings.theme === m.value} onClick={() => saveSettings({ theme: m.value })}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div class="field">
        <span>Màu nhấn</span>
        <div class="row accent-list" role="radiogroup" aria-label="Màu nhấn">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.value}
              role="radio"
              class="accent-swatch"
              aria-checked={settings.accent === p.value}
              title={p.name}
              aria-label={p.name}
              style={{ background: p.value }}
              onClick={() => saveSettings({ accent: p.value })}
            />
          ))}
        </div>
      </div>
      <div class="field">
        <span>Xem trước</span>
        <div class="card col preview">
          <div class="row">
            <button class="primary">Nút chính</button>
            <button>Nút phụ</button>
            <a href="#theme">Liên kết</a>
          </div>
          <div class="tabs">
            <button aria-selected="true">Đang chọn</button>
            <button aria-selected="false">Khác</button>
          </div>
        </div>
      </div>
      <p class="muted small">Áp dụng ngay cho side panel, cửa sổ soạn thư và trang cài đặt.</p>
    </section>
  );
}
