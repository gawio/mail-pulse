# Mail Pulse — Setup Guide

This guide covers setting up Google Cloud, building the extension, and installing it in Chrome, Edge, or Firefox.
For an overview of the project, see [README.md](README.md).

> **Firefox users:** do [step 1](#1-google-cloud-setup), then jump to [step 4](#4-firefox).

> **Note:** the extension UI is currently in Vietnamese. Where this guide mentions a UI label, the original text is
> shown in parentheses, e.g. **Settings → Accounts** (*Cài đặt → Tài khoản*).

## Prerequisites

- Node.js + npm
- `python3` (used by the `package:*` scripts to create zip files)
- A Google account with access to <https://console.cloud.google.com/>
- Chrome / Edge, or **Firefox 140+** (current ESR or newer)

---

## 1. Google Cloud setup

1. Go to <https://console.cloud.google.com/> and create a new project (e.g. `mail-pulse-personal`).
2. **APIs & Services → Library**: enable **Gmail API** and **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type: **External**. Fill in the app name, support email, and contact email.
   - **Audience → Publishing status: click "Publish app" to move it to In production.** You do not need to submit it
     for verification. When signing in, Google will show a "Google hasn't verified this app" warning → click
     **Advanced → Go to … (unsafe)**. This is fine for personal use (limited to 100 users).

     *Why not leave it in Testing?* In Testing mode, Google **expires refresh tokens after 7 days**, so you would have
     to sign in again every week. (If you still prefer Testing: add every Gmail address you'll use under
     **Audience → Test users**, and accept the weekly re-login.)
   - **Data access → Add or remove scopes**: add the scopes listed in [OAuth scopes](README.md#oauth-scopes).
4. Get the **redirect URI**:
   - **Firefox:** build and load the extension ([step 4](#4-firefox)), then open **Settings → Accounts → OAuth
     configuration info** (*Cài đặt → Tài khoản → Thông tin cấu hình OAuth*) and copy the URI of the form
     `http://127.0.0.1/mozoauth2/<code>` (no trailing `/`). Google does **not** accept Firefox's default
     `….extensions.allizom.org` domain because ownership can't be verified, so Mail Pulse uses the loopback address
     Firefox supports for `launchWebAuthFlow` — no real request is ever made to 127.0.0.1.
   - **Chrome / Edge:** run `npm run gen-key` ([step 2](#2-pin-the-extension-id-chrome--edge)).
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application** (not "Chrome extension" — that type only works with
     `chrome.identity.getAuthToken` and does not support multiple accounts).
   - **Authorized redirect URIs**: paste the URI from step 4, character for character. If you use both browsers, add
     both URIs to the same client.
   - Click **Create**, then copy the **Client ID** and **Client secret** into `.env`
     (`VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_SECRET`).

> **About the client secret:** it is bundled into the extension (a secret can't be kept in the browser), but Google
> still requires it for token exchange with Web application clients. PKCE plus the registered redirect URI still
> prevent others from using a leaked authorization code. **Do not share your build** — it contains your secret.

## 2. Pin the extension ID (Chrome / Edge)

The redirect URI depends on the extension ID. With "Load unpacked", the ID normally changes with the folder path, so
Mail Pulse uses the manifest `"key"` field to keep the ID fixed:

```bash
npm install
npm run gen-key
```

This script:
- generates an RSA key pair, writes the **public key** to `.env` (`EXTENSION_KEY=...`) and the private key to `key.pem`
  (git-ignored; only needed if you later want to pack a `.crx`);
- prints the **Extension ID** and **Redirect URI** to paste into Google Cloud
  (`https://<extension-id>.chromiumapp.org/`).

Running `npm run gen-key` again just reprints the existing ID. Use `npm run gen-key -- --force` to generate a new key
(the ID will change).

## 3. Configure, build, and install (Chrome / Edge)

```bash
cp .env.example .env     # if it doesn't exist yet (gen-key may already have created it)
# Edit .env:
#   VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
#   VITE_GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
#   EXTENSION_KEY=...   (filled in by gen-key)
npm run build            # -> dist/
```

**Chrome:** open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `dist/` folder.
Check that the displayed ID matches the one printed by `gen-key`.

**Edge** uses the same build as Chrome: `npm run package:edge` creates `mail-pulse-edge.zip` (the contents of `dist/`).
To install: `edge://extensions` → enable **Developer mode** → unzip and **Load unpacked** that folder (or select
`dist/` directly). Thanks to the `"key"` field, the extension ID — and the redirect URI — is identical to Chrome's, so
the same OAuth client works. If you publish to the Edge Add-ons store the ID will change: add the new redirect URI
(shown in Settings → Accounts).

Then click the Mail Pulse icon to open the popup → **Settings → Accounts → Add Google account**
(*Cài đặt → Tài khoản → + Thêm tài khoản Google*).

### Linux: Flatpak browsers

If your browser is installed via Flatpak (Chrome `com.google.Chrome`, Firefox `org.mozilla.firefox`), the sandbox can't
read the project folder by default, so the extension fails to load or loads with missing files. Grant **read-only**
access:

```bash
flatpak override --user --filesystem=/path/to/mail-pulse:ro com.google.Chrome
flatpak override --user --filesystem=/path/to/mail-pulse:ro org.mozilla.firefox
```

Then fully quit the browser (`flatpak kill <app-id>`) and reopen it. To revoke: replace `--filesystem=` with
`--nofilesystem=`.

## 4. Firefox

Requires **Firefox 140+**. For Flatpak Firefox, see the [Flatpak note](#linux-flatpak-browsers) above.

```bash
npm install
# .env:
#   VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
#   VITE_GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
#   FIREFOX_ADDON_ID=mail-pulse@your-name.local   # optional; the redirect URI depends on this ID
npm run build:firefox      # -> dist-firefox/
```

The add-on ID is pinned in `browser_specific_settings.gecko.id`, so the redirect URI stays the same across installs
(Firefox doesn't use the `"key"` field and doesn't need `gen-key`). **Changing `FIREFOX_ADDON_ID` changes the redirect
URI.**

### Installing in Firefox

Release Firefox only installs Mozilla-signed add-ons permanently. There are three options:

1. **Temporary (fastest way to try it):** `npm run package:firefox` → `about:debugging` → *This Firefox* →
   *Load Temporary Add-on…* → select **`mail-pulse-firefox.zip`**. The add-on is removed when Firefox closes and must be
   reloaded each time. (You can pick `dist-firefox/manifest.json` instead of the zip, **except with Flatpak Firefox**:
   the Flatpak file picker only shares the single selected file, so the extension loads but shows a blank UI. The zip
   doesn't have this problem.)
2. **Sign as "unlisted" on addons.mozilla.org (recommended for release Firefox):** see
   [Signing for permanent install](#signing-for-permanent-install) below.
3. **Firefox Developer Edition / Nightly:** set `xpinstall.signatures.required = false` in `about:config`, zip the
   contents of `dist-firefox/` (`cd dist-firefox && zip -r ../mail-pulse.xpi .`), then install from `about:addons` →
   ⚙ → *Install Add-on From File…*.

### Signing for permanent install

*Unlisted* add-ons are **not** shown publicly on addons.mozilla.org (AMO); Mozilla only receives the extension source
for automated review, never your data.

1. **Set a unique add-on ID** in `.env`. Every ID on AMO must be unique, so don't keep the default
   `mail-pulse@personal.local`:
   ```
   FIREFOX_ADDON_ID=mail-pulse@your-name.local
   ```
   Keep this ID **forever**: changing it creates a different add-on and a new redirect URI.
2. **Get an AMO API key:** create an AMO account, then generate a key at
   <https://addons.mozilla.org/developers/addon/api/key/> (*JWT issuer* + *JWT secret*).
3. **Build and sign:**
   ```bash
   npm run build:firefox
   npx web-ext sign --source-dir dist-firefox --channel unlisted \
     --api-key <JWT issuer> --api-secret <JWT secret>
   ```
   The signed `.xpi` is saved in `web-ext-artifacts/`.
4. **Install:** drag the `.xpi` into Firefox, or `about:addons` → ⚙ → *Install Add-on From File…*. It now survives
   restarts.
5. **Register the redirect URI:** open **Settings → Accounts → OAuth configuration info**
   (*Cài đặt → Tài khoản → Thông tin cấu hình OAuth*), copy the `http://127.0.0.1/mozoauth2/...` URI, and add it to
   *Authorized redirect URIs* of your OAuth client in Google Cloud ([step 1.5](#1-google-cloud-setup)).

### Updating a signed install

Unlisted add-ons don't auto-update. To install a newer build:

1. **Bump the version** in `src/manifest.ts` (`version: '0.1.0'` → `'0.1.1'`). AMO rejects a version it has already
   signed (*"Version already exists"*), so every signing needs a higher version — even for tiny changes.
2. **Rebuild and sign** with the same commands as above.
3. **Install the new `.xpi`** from `web-ext-artifacts/` the same way. Firefox upgrades the existing add-on in place;
   accounts, settings, and templates are kept. No need to uninstall first.

Keep `FIREFOX_ADDON_ID` unchanged — a different ID installs a second, separate add-on. Check the installed version at
`about:addons` → Mail Pulse.

### After installing

- Click the Mail Pulse toolbar icon (or press **Alt+Shift+M**) to open the inbox/calendar **popup**; click outside to
  close it.
- **Pin the button to the toolbar:** click the puzzle-piece (Extensions) icon → ⚙ next to Mail Pulse → **Pin to Toolbar**.
- On first run, check `about:addons` → Mail Pulse → *Permissions* that access to the Google domains is enabled.
- Add your account: **Settings → Accounts → Add Google account**.

---

## 5. Development

```bash
npm run dev            # Chrome: build --watch (sourcemaps, no minify); click "Reload" in chrome://extensions
npm run dev:firefox    # Firefox: build --watch; click "Reload" in about:debugging
npm test               # unit tests (MIME, addresses, mail parsing, templates, backoff, OAuth)
npm run typecheck
```

| Script | Output |
|---|---|
| `npm run build` | `dist/` (Chrome / Edge) |
| `npm run build:firefox` | `dist-firefox/` |
| `npm run package:edge` | `mail-pulse-edge.zip` |
| `npm run package:firefox` | `mail-pulse-firefox.zip` |

The **Alt+Shift+M** shortcut can be changed at `chrome://extensions/shortcuts` or `about:addons` → ⚙ →
*Manage Extension Shortcuts*.

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| `redirect_uri_mismatch` when signing in | The URI in Google Cloud must exactly match the one shown in Settings → Accounts → OAuth configuration info (no trailing `/` for Firefox). Check the extension ID matches `gen-key` output. |
| Must sign in again every week | The OAuth app is still in **Testing**. Publish it to *In production* (step 1.3). |
| Badge shows `!` | An account needs re-authentication (password change, access revoked, expired token). Click **Re-login** (*Đăng nhập lại*) in Settings → Accounts. |
| Account added by an older version (implicit flow) | Click **Re-login** once to obtain a refresh token. |
| Extension won't load / blank UI on Linux | See [Flatpak browsers](#linux-flatpak-browsers); in Firefox, load the zip instead of `manifest.json`. |
| Firefox add-on disappears after restart | Temporary add-ons are removed on exit. [Sign it as unlisted](#signing-for-permanent-install) for a permanent install. |
| `web-ext sign` fails with "Version already exists" | Bump `version` in `src/manifest.ts`, rebuild, and sign again. |
| `web-ext sign` says the add-on ID is taken / not owned by you | Choose a unique `FIREFOX_ADDON_ID` in `.env` (and register the new redirect URI in Google Cloud). |
| New `.xpi` installed as a second Mail Pulse | `FIREFOX_ADDON_ID` changed between builds. Restore the original ID and remove the duplicate. |
| Firefox says the file is corrupt / unsigned | Install the `.xpi` from `web-ext-artifacts/`, not a zip of `dist-firefox/`. |

To revoke Mail Pulse's access at any time: <https://myaccount.google.com/permissions>.
