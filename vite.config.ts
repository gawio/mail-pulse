/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { buildManifest, FIREFOX_BACKGROUND_HTML, type ManifestOptions } from './src/manifest';

/**
 * Sinh manifest.json từ src/manifest.ts theo trình duyệt đích.
 * Chrome: chèn "key" từ .env (EXTENSION_KEY). Firefox: gecko.id từ .env (FIREFOX_ADDON_ID) + background.html.
 */
function manifestPlugin(opts: ManifestOptions): Plugin {
  return {
    name: 'mail-pulse-manifest',
    generateBundle() {
      if (opts.target === 'chrome' && !opts.key) {
        this.warn('EXTENSION_KEY chưa đặt trong .env — extension ID sẽ thay đổi, OAuth redirect URI sẽ không khớp. Chạy `npm run gen-key`.');
      }
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(buildManifest(opts), null, 2) });
      if (opts.target === 'firefox') this.emitFile({ type: 'asset', fileName: 'background.html', source: FIREFOX_BACKGROUND_HTML });
    },
  };
}

// mode: production | development (Chrome), firefox | firefox-dev (Firefox)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = mode.startsWith('firefox') ? 'firefox' : 'chrome';
  const dev = mode === 'development' || mode === 'firefox-dev';
  if (!env.VITE_GOOGLE_CLIENT_ID) {
    console.warn('[mail-pulse] VITE_GOOGLE_CLIENT_ID chưa đặt trong .env — đăng nhập sẽ không hoạt động.');
  }
  if (!env.VITE_GOOGLE_CLIENT_SECRET) {
    console.warn('[mail-pulse] VITE_GOOGLE_CLIENT_SECRET chưa đặt trong .env — không đổi được token, đăng nhập sẽ không hoạt động.');
  }
  return {
    root: resolve(__dirname, 'src'),
    publicDir: resolve(__dirname, 'public'),
    plugins: [
      preact(),
      manifestPlugin({ target, key: env.EXTENSION_KEY || undefined, geckoId: env.FIREFOX_ADDON_ID || 'mail-pulse@personal.local' }),
    ],
    envDir: __dirname,
    build: {
      outDir: resolve(__dirname, target === 'firefox' ? 'dist-firefox' : 'dist'),
      emptyOutDir: true,
      target: target === 'firefox' ? 'firefox140' : 'chrome120',
      // Không có polyfill modulepreload (sẽ là inline script — bị CSP chặn và không cần thiết).
      modulePreload: { polyfill: false },
      sourcemap: dev,
      minify: !dev,
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'src/popup/index.html'),
          compose: resolve(__dirname, 'src/compose/index.html'),
          settings: resolve(__dirname, 'src/settings/index.html'),
          background: resolve(__dirname, 'src/background/index.ts'),
        },
        output: {
          entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
    test: {
      root: __dirname,
      include: ['src/**/*.test.ts'],
      environment: 'node',
    },
  };
});
