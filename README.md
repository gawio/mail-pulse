# Mail Pulse

A lightweight, privacy-first **Gmail + Google Calendar** client for **Chrome, Edge, and Firefox** (Manifest V3),
built for personal use.

👉 **Setup and installation instructions: [SETUP.md](SETUP.md)**

## Highlights

- **No backend, no analytics/telemetry, no CDN, no remote code.** The extension only talks to Google
  (`gmail.googleapis.com`, `www.googleapis.com`, `accounts.google.com`, `oauth2.googleapis.com`), enforced by
  `host_permissions`, the CSP `connect-src`, and an origin whitelist in `src/lib/http.ts`.
- **Multiple Google accounts** with a combined "All accounts" inbox view.
- **Unread count on the toolbar icon** (red badge), checking for new mail every 10 seconds.
- **Popup inbox** (click the icon or press **Alt+Shift+M**) to read, archive, mark read/unread, and trash mail.
- **Compose window** with rich text, attachments, recipient suggestions, templates, and auto-saved Gmail drafts.
- **7-day calendar** with event reminders and event creation (with Google Meet).
- **Light/dark theme** with a configurable accent color.
- **No permanent deletion:** the full `https://mail.google.com/` scope is never requested. "Delete" moves mail to
  Trash (`messages.trash`) and can be undone.

## Quick start

```bash
npm install
npm run gen-key          # Chrome/Edge only: pins the extension ID
cp .env.example .env     # add your Google OAuth client ID + secret
npm run build            # Chrome/Edge -> dist/
npm run build:firefox    # Firefox     -> dist-firefox/
```

You need your own Google Cloud OAuth client first — see [SETUP.md](SETUP.md) for the full walkthrough.

## How it works

### New-mail checks and the badge

- The badge shows the **total unread messages in the Inbox** across all accounts (`99+` above 99, `!` when an account
  needs re-login).
- Browser notifications for new mail are **off by default**; enable them in Settings → Notifications.
- Polling interval is configurable (5 / 10 / 15 / 30 s, 1 / 5 min; default 10 s). Since `chrome.alarms` can't go below
  30 seconds, polling runs as a loop in the background, with a 30-second alarm acting as a watchdog to restart it.
  Focusing the browser window also triggers an immediate check.
- Each check is a single `history.list` call per account; unread counts (`labels.get`) are reloaded only when the
  mailbox `historyId` changes. Quota usage stays far below Google's limits.
- True push (Gmail + Cloud Pub/Sub) would require a webhook server, which conflicts with the no-backend principle.

### Authentication

- **Authorization code flow + PKCE** (`access_type=offline`) with a *Web application* OAuth client.
  Redirect URI: `https://<extension-id>.chromiumapp.org/` (Chrome/Edge) or `http://127.0.0.1/mozoauth2/<code>` (Firefox).
- Each account stores a **refresh token**; access tokens (~1 hour) are refreshed via `oauth2.googleapis.com/token`,
  independent of browser Google cookies.
- Network errors / Google 5xx are treated as transient and retried with exponential backoff.
- `invalid_grant` (access revoked, password changed, token expired) marks the account **"Needs re-login"**, shows `!`
  on the badge, and stops API calls for that account — no notification spam.

### OAuth scopes

| Scope | Used for |
|---|---|
| `openid`, `email`, `profile` | Identify the account (stable ID, email, name, avatar). |
| `https://www.googleapis.com/auth/gmail.modify` | Read mail, change labels (read/unread, archive), move to Trash, send, manage drafts. **Cannot permanently delete.** |
| `https://www.googleapis.com/auth/calendar.events` | Read and create events (with Google Meet). |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | Read the **list of calendars** only. Optional — without it, only the `primary` calendar is used. |

### Browser permissions

| Permission | Used for |
|---|---|
| `identity` | `launchWebAuthFlow` — Google sign-in when adding / re-authenticating an account. |
| `alarms` | Polling watchdog (30 s), calendar sync (5 min), event reminders. |
| `notifications` | Event reminders, and new-mail notifications **if enabled**. |
| `storage` | Settings (`storage.local`) and session tokens (`storage.session`). |

Host permissions are limited to the four Google domains above. On Firefox, the manifest declares
`data_collection_permissions: { required: ["none"] }`.

### Where data is stored

**Email content is never written to disk.** Messages, events, and inbox lists live only in the memory of the open page.

| Data | Location |
|---|---|
| Account list (ID, email, name, avatar URL, color, notification toggle, "needs re-login" flag) | `storage.local` |
| Per-account OAuth refresh token (unencrypted, like all extension data) | `storage.local` |
| Per-account `historyId`; IDs of already-notified messages (≤ 200, IDs only) | `storage.local` |
| Your templates and settings | `storage.local` |
| Access tokens, backoff state, badge counts, notification → message mappings | `storage.session` (RAM only) |
| Recently seen email addresses for recipient suggestions (≤ 500) | `storage.session` (RAM only) |
| Drafts | **Gmail** (`users.drafts`), just like Gmail web |

Removing an account revokes its refresh token and deletes all related data. Uninstalling the extension clears all
storage. You can also revoke access at <https://myaccount.google.com/permissions>.

### Safe email rendering

- Email HTML is parsed with `DOMParser` (inert document), stripped of `script/iframe/object/embed/link/meta/base/form`,
  `on*` attributes, and `javascript:`/`data:text` URLs, then rendered in an `<iframe sandbox srcdoc>` **without
  `allow-scripts` or `allow-forms`**.
- The iframe has its own CSP (`default-src 'none'; img-src data:`), blocking scripts, fonts, external CSS, and
  **remote images** (tracking pixels). A **"Show images"** button allows `img-src https:` for that message only.
- Links open in a new tab with `rel="noopener noreferrer"`; `mailto:` opens the compose window. Inline `cid:` images
  are fetched via `attachments.get` and embedded as `data:` URLs.
- Extension pages never use `innerHTML` with email data. Editor/template content is filtered by a whitelist
  (`src/lib/html-clean.ts`), and pasting into the editor is always plain text.
- Extension page CSP: `script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`, `connect-src`
  limited to Google domains.

## Chrome vs. Firefox

| Feature | Chrome / Edge | Firefox |
|---|---|---|
| Main UI | Popup on icon click | Popup on icon click |
| "Mark read" / "Archive" buttons on new-mail notifications | Yes | **No** (Firefox doesn't support notification buttons) |
| Clicking a mail notification | Opens popup with the message | Opens the message in a tab |
| Clicking an event reminder | Opens Google Calendar; separate "Open Google Meet" button | Opens Google Meet if available, otherwise Google Calendar |
| Background | Service worker | Event page (`background.html`) |

## Dependencies

| Package | Type | Purpose |
|---|---|---|
| `preact` | runtime | UI components (~4 KB gzip). The **only** runtime dependency. |
| `vite`, `@preact/preset-vite` | dev | Multi-entry build (popup, compose, settings, background), JSX. |
| `typescript`, `@types/chrome`, `@types/node` | dev | Strict type checking. |
| `vitest` | dev | Unit tests for pure logic (MIME, addresses, templates, OAuth…). |

No editor, sanitizer, MIME, or date libraries — these are small, hand-written, and tested.

## Project structure

```
src/
  manifest.ts             MV3 manifest for Chrome and Firefox (generates manifest.json at build time)
  background/             Service worker / event page
    index.ts                registers listeners
    alarms.ts               poll / calendar-sync scheduling
    poller.ts               history.list, new-mail detection, unread counts
    notifier.ts             notifications, action buttons, badge
    calendar-reminder.ts    schedules/cancels event reminder alarms
  lib/
    ext.ts                  shared namespace: `browser` (Firefox) / `chrome` (Chrome)
    auth.ts                 OAuth code flow + PKCE, refresh tokens, multi-account
    oauth.ts                pure OAuth helpers (PKCE, URLs, response parsing) — tested
    http.ts                 token-aware fetch per accountId, origin whitelist
    gmail-client.ts         Gmail API
    calendar-client.ts      Calendar API
    mime.ts                 RFC 2822 multipart message builder
    mail-parse.ts           parses format=full payloads
    sanitize.ts             prepares email HTML for the sandboxed iframe
    html-clean.ts           whitelist filter for editor/template HTML
    templates.ts            {{...}} variables, import/export
    backoff.ts              per-account exponential backoff
    storage.ts              typed storage
    address.ts              email address parsing
  popup/                  inbox, message view, calendar
  compose/                compose window, recipient suggestions, templates, save-draft-on-close
  settings/               accounts, notifications, templates, theme
  shared/                 theme (CSS variables), components, editor
scripts/
  gen-key.mjs             pins the extension ID
  gen-icons.mjs           generates PNG icons (no dependencies)
```

## Known limitations

- **The client secret is embedded in the build** (there's no backend to hold it). Only use builds made for yourself.
- If the OAuth app stays in **Testing**, refresh tokens expire after 7 days and you'll need to sign in weekly.
- Clicking a notification tries `action.openPopup` (Chrome 127+); where unsupported (Firefox, older Chrome), the
  message opens in a tab.
- The popup closes when it loses focus, so re-login from the popup opens Settings → Accounts to run the sign-in there.
- Firefox: unsigned add-ons can only be installed temporarily (see [SETUP.md](SETUP.md#installing-in-firefox)).
- "All accounts" mode loads 25 messages per page **per account** and merges them by date.
- Saving a draft on window close is best-effort (sent to the background in `pagehide`); auto-save every 10 seconds is
  the primary mechanism.
- The editor uses `document.execCommand` (deprecated but still supported) to avoid an editor library dependency.
- Forwarding keeps original attachments but not inline (`cid:`) images in the body.
- The UI is currently in Vietnamese.

## License

MIT
