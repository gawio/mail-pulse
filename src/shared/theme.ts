/**
 * Theme: Light / Dark / Theo hệ thống + màu nhấn. Áp dụng qua CSS variables trên <html>.
 * Dùng chung cho side panel, cửa sổ soạn mail và settings; tự cập nhật khi settings đổi.
 */
import { getLocal, onStorageChange, type Settings } from '../lib/storage';

export const ACCENT_PRESETS: { name: string; value: string }[] = [
  { name: 'Xanh dương', value: '#3b6fe0' },
  { name: 'Xanh lá', value: '#2b8a3e' },
  { name: 'Tím', value: '#7048e8' },
  { name: 'Cam', value: '#e8590c' },
  { name: 'Hồng', value: '#c2255c' },
  { name: 'Xám', value: '#495057' },
];

const media = window.matchMedia('(prefers-color-scheme: dark)');
let current: Pick<Settings, 'theme' | 'accent'> | null = null;

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = parseInt(m?.[1] ?? '3b6fe0', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function applyTheme(s: Pick<Settings, 'theme' | 'accent'>): void {
  current = s;
  const root = document.documentElement;
  const dark = s.theme === 'dark' || (s.theme === 'system' && media.matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  const [r, g, b] = hexToRgb(s.accent);
  root.style.setProperty('--accent', `rgb(${r} ${g} ${b})`);
  root.style.setProperty('--accent-soft', `rgb(${r} ${g} ${b} / ${dark ? 0.22 : 0.12})`);
  // Chữ trên nền accent: chọn đen/trắng theo độ sáng.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  root.style.setProperty('--on-accent', lum > 0.6 ? '#111' : '#fff');
}

export async function initTheme(): Promise<void> {
  applyTheme(await getLocal('settings'));
  onStorageChange('local', 'settings', applyTheme);
  media.addEventListener('change', () => {
    if (current?.theme === 'system') applyTheme(current);
  });
}
