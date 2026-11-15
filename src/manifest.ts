export const ALLOWED_ORIGINS = [
  'https://gmail.googleapis.com',
  'https://www.googleapis.com',
  'https://accounts.google.com',
  'https://oauth2.googleapis.com',
] as const;

const CSP = [
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  `connect-src ${ALLOWED_ORIGINS.join(' ')}`,
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "media-src 'self'",
  "worker-src 'self'",
].join('; ');

export type Target = 'chrome' | 'firefox';

export interface ManifestOptions {
  target: Target;
  key?: string;
  geckoId: string;
}

export const FIREFOX_BACKGROUND_HTML =
  '<!doctype html>\n<html><head><meta charset="utf-8"><script type="module" src="background.js"></script></head></html>\n';

export function buildManifest(opts: ManifestOptions): Record<string, unknown> {
  const common = {
    manifest_version: 3,
    name: 'Mail Pulse',
    short_name: 'Mail Pulse',
    version: '0.1.1',
    description: 'Gmail + Google Calendar mini client. Không backend, không telemetry.',
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    action: {
      default_title: 'Mail Pulse',
      default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' },
      default_popup: 'popup/index.html',
    },
    options_ui: { page: 'settings/index.html', open_in_tab: true },
    host_permissions: ALLOWED_ORIGINS.map((o) => `${o}/*`),
    content_security_policy: { extension_pages: CSP },
  };
  const SHORTCUT = { default: 'Alt+Shift+M' };

  if (opts.target === 'firefox') {
    return {
      ...common,
      background: { page: 'background.html' },
      permissions: ['identity', 'alarms', 'notifications', 'storage'],
      commands: { _execute_action: { suggested_key: SHORTCUT, description: 'Mở Mail Pulse' } },
      browser_specific_settings: {
        gecko: {
          id: opts.geckoId,
          strict_min_version: '140.0',
          data_collection_permissions: { required: ['none'] },
        },
        gecko_android: {
          strict_min_version: '142.0',
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
