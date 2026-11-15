/**
 * Manifest V3 của Mail Pulse. Được vite.config.ts dùng để sinh dist/manifest.json.
 * File này chạy trong Node lúc build — không dùng API chrome ở đây.
 */
export const ALLOWED_ORIGINS = [
  'https://gmail.googleapis.com',
  'https://www.googleapis.com',
  'https://accounts.google.com',
  // Token endpoint: đổi code lấy token, làm mới bằng refresh token, thu hồi khi xoá tài khoản.
  'https://oauth2.googleapis.com',
] as const;

const CSP = [
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  `connect-src ${ALLOWED_ORIGINS.join(' ')}`,
  // Ảnh: avatar Google + ảnh trong mail khi người dùng bấm "Hiện ảnh" (iframe srcdoc kế thừa CSP này,
  // và iframe còn tự có CSP chặt hơn — mặc định chặn ảnh remote).
  "img-src 'self' data: blob: https:",
  // Mail HTML dùng inline style; chỉ cho phép style, không cho script.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "media-src 'self'",
  "worker-src 'self'",
].join('; ');

export type Target = 'chrome' | 'firefox';

export interface ManifestOptions {
  target: Target;
  /** Chrome: public key để cố định extension ID (EXTENSION_KEY). */
  key?: string;
  /** Firefox: add-on ID cố định (browser_specific_settings.gecko.id). */
  geckoId: string;
}

/** Trang background cho Firefox (event page): nạp background.js dạng ES module, không có inline script. */
export const FIREFOX_BACKGROUND_HTML =
  '<!doctype html>\n<html><head><meta charset="utf-8"><script type="module" src="background.js"></script></head></html>\n';

export function buildManifest(opts: ManifestOptions): Record<string, unknown> {
  const common = {
    manifest_version: 3,
    name: 'Mail Pulse',
    short_name: 'Mail Pulse',
    version: '0.1.0',
    description: 'Gmail + Google Calendar mini client. Không backend, không telemetry.',
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    // Bấm icon trên thanh công cụ -> popup thả xuống (hộp thư, lịch).
    action: {
      default_title: 'Mail Pulse',
      default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' },
      default_popup: 'popup/index.html',
    },
    options_ui: { page: 'settings/index.html', open_in_tab: true },
    host_permissions: ALLOWED_ORIGINS.map((o) => `${o}/*`),
    content_security_policy: { extension_pages: CSP },
  };
  /** Phím tắt bật/tắt Mail Pulse (đổi được trong cài đặt phím tắt của trình duyệt). */
  const SHORTCUT = { default: 'Alt+Shift+M' };

  if (opts.target === 'firefox') {
    return {
      ...common,
      // Firefox không hỗ trợ background.service_worker — dùng event page.
      background: { page: 'background.html' },
      permissions: ['identity', 'alarms', 'notifications', 'storage'],
      commands: { _execute_action: { suggested_key: SHORTCUT, description: 'Mở Mail Pulse' } },
      browser_specific_settings: {
        gecko: {
          id: opts.geckoId,
          // storage.session (115+), host_permissions cấp khi cài với MV3 (127+), data_collection_permissions (140+) -> ESR 140.
          strict_min_version: '140.0',
          data_collection_permissions: { required: ['none'] },
        },
      },
    };
  }

  return {
    ...common,
    minimum_chrome_version: '120',
    ...(opts.key ? { key: opts.key } : {}),
    background: { service_worker: 'background.js', type: 'module' },
    permissions: ['identity', 'alarms', 'notifications', 'storage'],
    commands: { _execute_action: { suggested_key: SHORTCUT, description: 'Mở Mail Pulse' } },
  };
}
