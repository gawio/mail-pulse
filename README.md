# Mail Pulse

Gmail + Google Calendar client mini cho **Firefox** và Chrome (Manifest V3), dùng cá nhân, ưu tiên quyền riêng tư tuyệt đối.

> Dùng Firefox: làm theo mục 1 rồi nhảy tới [mục 3b](#3b-firefox).

- **Không backend, không analytics/telemetry, không CDN, không remote code.** Extension chỉ gửi request tới
  `https://gmail.googleapis.com`, `https://www.googleapis.com` và `https://accounts.google.com` — được ép bằng cả
  `host_permissions`, CSP `connect-src` và một whitelist trong `src/lib/http.ts`.
- Nhiều tài khoản Google, **số thư chưa đọc trên icon** (nền đỏ, kiểu YouTube), kiểm tra thư mới mỗi 10 giây, popup (bấm icon) đọc/xử lý thư, soạn thư (rich text, đính kèm, nháp),
  template, lịch 7 ngày + nhắc sự kiện, theme sáng/tối.
- **Không có xoá vĩnh viễn**: không xin scope `https://mail.google.com/`; "Xoá" = chuyển vào Thùng rác (`messages.trash`), có Hoàn tác.

---

## 1. Cài đặt Google Cloud

1. Vào <https://console.cloud.google.com/> → tạo project mới (vd. `mail-pulse-personal`).
2. **APIs & Services → Library**: bật **Gmail API** và **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type: **External**. Điền tên app, email hỗ trợ, email liên hệ.
   - **Audience → Publishing status: bấm "Publish app" để chuyển sang In production.** Không cần gửi xác minh: khi đăng
     nhập Google sẽ hiện cảnh báo "Google chưa xác minh ứng dụng này" → **Nâng cao → Đi tới … (không an toàn)**, dùng cá
     nhân vẫn được (giới hạn 100 người dùng).
     *Tại sao không để Testing?* Ở trạng thái Testing, Google cho refresh token **hết hạn sau 7 ngày** → tuần nào cũng
     phải đăng nhập lại.
     (Nếu vẫn muốn để Testing: vào **Audience → Test users** thêm mọi email Gmail sẽ dùng, và chấp nhận đăng nhập lại mỗi tuần.)
   - **Data access → Add or remove scopes**: thêm các scope ở [bảng scope](#scope-oauth) bên dưới.
4. Lấy **redirect URI**:
   - Firefox: build + nạp extension (mục 3b), mở **Cài đặt → Tài khoản → Thông tin cấu hình OAuth** và sao chép URI
     dạng `http://127.0.0.1/mozoauth2/<mã>` (không có `/` ở cuối). Google **không** chấp nhận tên miền mặc định
     `….extensions.allizom.org` của Firefox vì chưa xác minh quyền sở hữu, nên Mail Pulse dùng địa chỉ loopback mà
     Firefox hỗ trợ cho `launchWebAuthFlow` — không có request thật nào tới 127.0.0.1.
   - Chrome: chạy `npm run gen-key` (mục 2).
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application** (không phải "Chrome extension" — loại đó chỉ dùng với `chrome.identity.getAuthToken`
     và không hỗ trợ nhiều tài khoản).
   - **Authorized redirect URIs**: dán URI ở bước 4, đúng từng ký tự. Dùng cả hai trình duyệt thì thêm cả hai URI vào
     cùng một client.
   - Bấm Create → sao chép **Client ID** và **Client secret** vào `.env` (`VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_SECRET`).
     Client secret bị đóng gói vào extension (không thể giữ bí mật ở phía trình duyệt); với client loại Web application
     Google vẫn bắt buộc gửi nó khi đổi token. PKCE + redirect URI đã đăng ký vẫn ngăn người khác dùng mã xác thực bị lộ.
     **Đừng chia sẻ bản build** chứa secret của bạn.

## 2. Cố định extension ID (Chrome)

Redirect URI phụ thuộc extension ID. Với "Load unpacked", ID mặc định thay đổi theo đường dẫn thư mục, nên Mail Pulse
dùng trường `"key"` trong manifest để cố định ID:

```bash
npm install
npm run gen-key
```

Script này:
- tạo cặp khoá RSA, ghi **public key** vào `.env` (`EXTENSION_KEY=...`) và private key vào `key.pem` (đã `.gitignore`,
  chỉ cần nếu sau này muốn đóng gói `.crx`);
- in ra **Extension ID** và **Redirect URI** để dán vào Google Cloud.

Chạy lại `npm run gen-key` chỉ in lại ID hiện có; `npm run gen-key -- --force` để tạo khoá mới (ID sẽ đổi).

## 3. Cấu hình, build và cài

```bash
cp .env.example .env     # nếu chưa có (gen-key đã tạo .env thì chỉ cần thêm dòng client ID)
# Sửa .env:
#   VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
#   VITE_GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
#   EXTENSION_KEY=...   (do gen-key điền)
npm run build
```

Mở `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn thư mục `dist/`.

**Edge** dùng chung bản build Chrome: `npm run package:edge` → tạo `mail-pulse-edge.zip` (nội dung thư mục `dist/`).
Cài: `edge://extensions` → bật **Developer mode** → giải nén zip rồi **Load unpacked** thư mục đó (hoặc chọn thẳng `dist/`).
Nhờ trường `"key"`, extension ID — và redirect URI `https://<extension-id>.chromiumapp.org/` — giống hệt Chrome, nên dùng
chung OAuth client. Nếu đăng lên Edge Add-ons store, ID sẽ khác: thêm redirect URI mới (xem trong Cài đặt → Tài khoản).

> **Linux + trình duyệt cài bằng Flatpak** (Chrome `com.google.Chrome`, Firefox `org.mozilla.firefox`): sandbox Flatpak
> mặc định không đọc được thư mục project, nên extension không nạp được hoặc nạp thiếu file. Cấp quyền **chỉ đọc**:
> ```bash
> flatpak override --user --filesystem=/đường/dẫn/tới/email-extension:ro com.google.Chrome
> flatpak override --user --filesystem=/đường/dẫn/tới/email-extension:ro org.mozilla.firefox
> ```
> rồi tắt hẳn trình duyệt (`flatpak kill <app-id>`) và mở lại. Gỡ quyền: thay `--filesystem=` bằng `--nofilesystem=`.

Kiểm tra ID hiển thị trùng với ID mà `gen-key` in ra.

Sau đó: bấm icon Mail Pulse để mở popup → **Cài đặt → Tài khoản → Thêm tài khoản Google**.

Phát triển:

```bash
npm run dev        # build --watch (sourcemap, không minify); bấm "Reload" trong chrome://extensions
npm test           # unit test (MIME, địa chỉ, parse mail, template, backoff)
npm run typecheck
```

## 3b. Firefox

Yêu cầu **Firefox 140+** (bản ESR hiện tại trở lên). Firefox cài bằng Flatpak: xem ghi chú Flatpak ở mục 3.

```bash
npm install
# .env:
#   VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
#   VITE_GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
#   FIREFOX_ADDON_ID=mail-pulse@ten-cua-ban.local   # tuỳ chọn; redirect URI phụ thuộc ID này
npm run build:firefox      # -> thư mục dist-firefox/
```

Add-on ID được cố định trong `browser_specific_settings.gecko.id`, nên redirect URI không đổi giữa các lần cài
(Firefox không dùng trường `"key"` và không cần `gen-key`). **Đổi `FIREFOX_ADDON_ID` thì redirect URI cũng đổi.**

**Cài vào Firefox** — Firefox bản thường chỉ cài vĩnh viễn add-on đã được Mozilla ký. Có 3 cách:

1. **Tạm thời (nhanh nhất để thử):** `npm run package:firefox` → `about:debugging` → *This Firefox* →
   *Load Temporary Add-on…* → chọn file **`mail-pulse-firefox.zip`**. Add-on bị gỡ khi đóng Firefox, phải nạp lại mỗi lần.
   (Có thể chọn `dist-firefox/manifest.json` thay cho zip, **trừ khi Firefox cài bằng Flatpak**: hộp chọn file của Flatpak
   chỉ chia sẻ đúng một file được chọn, extension sẽ nạp được nhưng giao diện trắng. File zip không gặp vấn đề này.)
2. **Ký "unlisted" trên addons.mozilla.org (khuyên dùng cho Firefox bản thường):** tạo tài khoản AMO, lấy API key tại
   <https://addons.mozilla.org/developers/addon/api/key/>, rồi:
   ```bash
   npx web-ext sign --source-dir dist-firefox --channel unlisted --api-key <JWT issuer> --api-secret <JWT secret>
   ```
   Bạn nhận về file `.xpi` đã ký để cài vĩnh viễn. Bản *unlisted* **không** hiển thị công khai trên AMO; Mozilla chỉ nhận
   mã nguồn extension để kiểm tra tự động, không nhận dữ liệu của bạn.
3. **Firefox Developer Edition / Nightly:** đặt `xpinstall.signatures.required = false` trong `about:config`, nén nội dung
   `dist-firefox/` thành zip (`cd dist-firefox && zip -r ../mail-pulse.xpi .`) rồi cài từ `about:addons` → ⚙ →
   *Install Add-on From File…*.

Sau khi cài: bấm icon Mail Pulse trên thanh công cụ (hoặc nhấn **Alt+Shift+M**) để mở **popup** hộp thư/lịch;
bấm ra ngoài là popup đóng.

**Ghim nút Mail Pulse lên thanh công cụ:** bấm icon mảnh ghép (Extensions) → ⚙ cạnh Mail Pulse → **Pin to Toolbar**.
Lần đầu, kiểm tra `about:addons` → Mail Pulse → *Permissions* rằng quyền truy cập 3 domain Google đã bật.

Khác biệt trên Firefox (do giới hạn API của Firefox):

| Tính năng | Chrome | Firefox |
|---|---|---|
| Giao diện chính | Popup khi bấm icon | Popup khi bấm icon |
| Nút "Đã đọc"/"Archive" trên popup thư mới (nếu bật popup) | Có | **Không** — Firefox không hỗ trợ nút trên thông báo. Bấm thông báo để mở thư rồi thao tác. |
| Tài khoản nhận trên thông báo | Dòng phụ (`contextMessage`) | Ghi ở dòng cuối nội dung thông báo |
| Bấm thông báo thư | Mở popup và hiện thư | Mở thư trong một tab (Firefox không cho mở popup từ thông báo) |
| Bấm thông báo nhắc sự kiện | Mở Google Calendar; nút riêng "Mở Google Meet" | Mở Google Meet nếu có, nếu không thì mở Google Calendar |
| Background | Service worker | Event page (`background.html`) |

Phát triển: `npm run dev:firefox` (build --watch), rồi bấm *Reload* trong `about:debugging`.

Phím tắt **Alt+Shift+M** mở popup trên cả Chrome và Firefox; đổi phím tại
`chrome://extensions/shortcuts` hoặc `about:addons` → ⚙ → *Manage Extension Shortcuts*.

---

## 4. Số trên icon và tốc độ nhận thư

- Icon hiển thị **tổng số thư chưa đọc trong Hộp thư đến** của mọi tài khoản, nền đỏ chữ trắng; quá 99 hiện `99+`;
  `!` khi có tài khoản cần đăng nhập lại.
- Popup thông báo của trình duyệt cho thư mới **tắt mặc định**; bật lại trong Cài đặt → Thông báo nếu muốn.
- Kiểm tra thư mới mỗi **10 giây** (chọn được 5 / 10 / 15 / 30 giây, 1 / 5 phút). `chrome.alarms` không cho phép dưới
  30 giây, nên việc kiểm tra chạy bằng vòng lặp trong background; alarm 30 giây chỉ làm "người gác" khởi động lại vòng
  lặp nếu trình duyệt đã tắt background. Quay lại cửa sổ trình duyệt cũng kích hoạt kiểm tra ngay.
- Mỗi lần kiểm tra chỉ gọi `history.list` (1 request/tài khoản). Số chưa đọc (`labels.get`) chỉ tải lại khi `historyId`
  của hộp thư thay đổi — kể cả khi bạn đọc/archive thư ở Gmail web hay điện thoại. Với 10 giây/lần, mức dùng quota Gmail
  rất nhỏ so với giới hạn của Google.
- Muốn tức thì hơn nữa cần Gmail push (Cloud Pub/Sub) — đòi hỏi server nhận webhook, trái với nguyên tắc không backend.

## 4b. Quyền (permissions) và scope

### Permission trong manifest

| Permission | Dùng cho |
|---|---|
| `identity` | `chrome.identity.launchWebAuthFlow` — mở trang đăng nhập Google khi bạn thêm tài khoản / đăng nhập lại. |
| `alarms` | Alarm "gác" 30 giây để nối lại vòng lặp kiểm tra thư nếu trình duyệt tắt background; đồng bộ lịch mỗi 5 phút; hẹn giờ nhắc sự kiện. |
| `notifications` | Nhắc sự kiện lịch, và popup thư mới **nếu bạn bật** (mặc định tắt — chỉ hiện số trên icon). |
| `storage` | Lưu cấu hình (`storage.local`) và token phiên (`storage.session`) — xem [mục 5](#5-dữ-liệu-được-lưu-ở-đâu). |
| `offscreen` | **Không dùng** — Mail Pulse dùng âm thanh thông báo mặc định của hệ điều hành nên không cần. |

Firefox: manifest có `browser_specific_settings.gecko.data_collection_permissions: { required: ["none"] }` — khai báo với
Firefox/AMO rằng add-on **không thu thập dữ liệu nào**.

| Host permission | Dùng cho |
|---|---|
| `https://gmail.googleapis.com/*` | Gmail API (đọc, đánh dấu, archive, trash, gửi, nháp, đính kèm). |
| `https://www.googleapis.com/*` | Calendar API và `oauth2/v3/userinfo` (lấy email/tên/avatar khi thêm tài khoản). |
| `https://accounts.google.com/*` | Trang đăng nhập OAuth. |
| `https://oauth2.googleapis.com/*` | Đổi mã xác thực lấy token, làm mới access token bằng refresh token, thu hồi quyền khi xoá tài khoản. |

### Scope OAuth

| Scope | Dùng cho |
|---|---|
| `openid`, `email`, `profile` | Nhận diện tài khoản (ID ổn định, email, tên, avatar) — phân biệt nhiều tài khoản. |
| `https://www.googleapis.com/auth/gmail.modify` | Đọc thư, đổi nhãn (đã đọc/chưa đọc, archive), chuyển vào Thùng rác, gửi thư, quản lý nháp. **Không cho phép xoá vĩnh viễn.** |
| `https://www.googleapis.com/auth/calendar.events` | Đọc sự kiện, tạo sự kiện (kèm Google Meet). |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | Chỉ đọc **danh sách lịch** (`calendarList.list`). Cần thêm vì `calendarList.list` không chấp nhận scope `calendar.events`. Nếu không được cấp, Mail Pulse chỉ dùng lịch chính (`primary`). |

**Không** xin `https://mail.google.com/` (toàn quyền, gồm xoá vĩnh viễn) hay `calendar` (toàn quyền lịch).

Auth dùng **authorization code flow + PKCE** (`response_type=code`, `access_type=offline`) với client loại
*Web application*, redirect `https://<extension-id>.chromiumapp.org/` (Chrome) hoặc `http://127.0.0.1/mozoauth2/<mã>`
(Firefox). Mỗi tài khoản có một **refresh token** lưu trong `storage.local`; access token (~1 giờ) được làm mới bằng
refresh token qua `oauth2.googleapis.com/token` — không phụ thuộc cookie/phiên Google trong trình duyệt.

- Lỗi mạng / máy chủ Google lỗi 5xx: coi là tạm thời, thử lại với backoff — **không** bắt đăng nhập lại.
- Google trả `invalid_grant` (bạn gỡ quyền, đổi mật khẩu, refresh token hết hạn): tài khoản được đánh dấu
  **"Cần đăng nhập lại"**, badge hiện **`!`** và Mail Pulse ngừng gọi API cho tài khoản đó — không bật popup, không spam.
- Tài khoản thêm từ bản cũ (implicit flow) chưa có refresh token: cần bấm "Đăng nhập lại" **một lần**.

## 5. Dữ liệu được lưu ở đâu

**Nội dung thư không bao giờ được ghi xuống đĩa.** Thư, sự kiện, danh sách inbox chỉ nằm trong bộ nhớ của trang đang mở.

| Dữ liệu | Nơi lưu | Ghi chú |
|---|---|---|
| Danh sách tài khoản: ID (`sub`), email, tên, URL avatar, màu, bật/tắt thông báo, cờ "cần đăng nhập lại" | `storage.local` | |
| Refresh token OAuth theo tài khoản | `storage.local` | Lưu trên đĩa (không mã hoá — giống mọi dữ liệu extension) để không phải đăng nhập lại. Bị xoá khi xoá tài khoản hoặc khi Google từ chối. |
| `historyId` theo tài khoản | `storage.local` | Mốc để `history.list` phát hiện thư mới. |
| ID thư đã thông báo (≤ 200/tài khoản) | `storage.local` | Chỉ ID, không có tiêu đề/người gửi. Tránh báo trùng. |
| Template (tên, tiêu đề, nội dung, tài khoản mặc định) | `storage.local` | Do bạn tự soạn. |
| Cài đặt (chu kỳ kiểm tra, bật/tắt popup, bỏ qua Promotions/Social, phút nhắc, theme, màu nhấn) | `storage.local` | |
| Access token + thời điểm hết hạn | `storage.session` | Chỉ trong RAM, **mất khi đóng trình duyệt**. |
| Trạng thái backoff, số unread cho badge, thời điểm kiểm tra gần nhất | `storage.session` | |
| Ánh xạ thông báo → ID thư / link sự kiện | `storage.session` | Để nút trên thông báo biết thao tác với thư nào. |
| Địa chỉ email đã thấy (≤ 500) | `storage.session` | Gợi ý người nhận khi soạn thư; mất khi đóng trình duyệt. |
| Tên alarm nhắc sự kiện đã báo | `storage.session` | Tên alarm chỉ chứa ID tài khoản/lịch/sự kiện + giờ bắt đầu, không có tiêu đề. |
| Nháp thư | **Gmail** (`users.drafts`) | Lưu trên server Gmail, như Gmail web. |

Xoá tài khoản trong Cài đặt: thu hồi quyền (refresh token) và xoá mọi mục liên quan ở trên. Gỡ extension sẽ xoá toàn bộ storage.
Bạn cũng có thể thu hồi quyền tại <https://myaccount.google.com/permissions>.

## 6. Hiển thị thư an toàn

- HTML thư được lọc bằng `DOMParser` (tài liệu trơ) rồi đưa vào `<iframe sandbox srcdoc>` **không có `allow-scripts`, không có `allow-forms`**.
- Tài liệu trong iframe có CSP riêng: `default-src 'none'; img-src data:` — chặn script, font, CSS và **ảnh từ xa** (chống pixel theo dõi).
  Nút **"Hiện ảnh"** mới cho phép `img-src https:` cho thư đó.
- Bỏ `script/iframe/object/embed/link/meta/base/form`, mọi thuộc tính `on*`, URL `javascript:`/`data:text`.
- Link mở tab mới với `rel="noopener noreferrer"`; `mailto:` mở cửa sổ soạn thư.
- Ảnh inline (`cid:`) được tải qua `attachments.get` và nhúng dạng `data:`.
- Trang extension không dùng `innerHTML` với dữ liệu thư. Trích dẫn khi trả lời được dựng bằng `textContent`;
  nội dung editor/template được lọc theo whitelist (`src/lib/html-clean.ts`). Dán vào editor luôn chỉ lấy văn bản thuần.
- CSP của trang extension: `script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src` chỉ 3 domain Google.
  (`style-src 'unsafe-inline'` là cần thiết vì HTML thư dùng inline style; không ảnh hưởng tới script.)

## 7. Dependency

| Gói | Loại | Lý do |
|---|---|---|
| `preact` | runtime | UI component (~4 KB gzip). Dependency runtime **duy nhất**. |
| `vite` | dev | Build multi-entry (popup, compose, settings, service worker), không inline script. |
| `@preact/preset-vite` | dev | JSX cho Preact trong Vite. |
| `typescript` | dev | Kiểm tra kiểu (`strict`, `noUncheckedIndexedAccess`). |
| `@types/chrome` | dev | Kiểu cho API `chrome.*`. |
| `@types/node` | dev | Kiểu cho `vite.config.ts` và script `gen-key`. |
| `vitest` | dev | Unit test cho phần logic thuần (MIME, địa chỉ, template…). |

Không có thư viện editor, sanitizer, MIME hay date — các phần này được viết tay, nhỏ, và có test.

## 8. Cấu trúc

```
src/
  manifest.ts             Manifest MV3 cho Chrome và Firefox (sinh manifest.json lúc build)
  background/             Service worker
    index.ts                đăng ký listener
    alarms.ts               chu kỳ poll / sync lịch
    poller.ts               history.list, phát hiện thư mới, số unread
    notifier.ts             thông báo, nút thao tác, badge
    calendar-reminder.ts    đặt/huỷ alarm nhắc sự kiện
  lib/
    ext.ts                  namespace dùng chung: `browser` (Firefox) / `chrome` (Chrome)
    auth.ts                 OAuth code flow + PKCE, refresh token, multi-account
    oauth.ts                phần thuần của OAuth (PKCE, URL, đọc phản hồi) — có test
    http.ts                 fetch có token theo accountId, whitelist origin
    gmail-client.ts         Gmail API
    calendar-client.ts      Calendar API
    mime.ts                 tạo thư RFC 2822 multipart
    mail-parse.ts           đọc payload format=full
    sanitize.ts             chuẩn bị HTML thư cho iframe sandbox
    html-clean.ts           lọc whitelist cho editor/template
    templates.ts            biến {{...}}, import/export
    backoff.ts              exponential backoff theo tài khoản
    storage.ts              storage có kiểu
    address.ts              phân tích địa chỉ email
  popup/                  inbox, message-view, calendar
  compose/                cửa sổ soạn thư, gợi ý người nhận, template, lưu nháp khi đóng
  settings/               accounts, notifications, templates, theme
  shared/                 theme (CSS variables), components, editor
scripts/
  gen-key.mjs             cố định extension ID
  gen-icons.mjs           sinh icon PNG (không cần thư viện)
```

## 9. Hạn chế đã biết

- **Client secret nằm trong bản build** (không có backend để giữ). Chỉ dùng bản build cho chính bạn.
- App để ở trạng thái **Testing** thì refresh token hết hạn sau 7 ngày → phải đăng nhập lại hằng tuần (xem mục 1).
- Click thông báo sẽ thử mở popup (`action.openPopup`, Chrome 127+); nếu trình duyệt không cho (Firefox, Chrome cũ),
  thư được mở trong một tab.
- Popup tự đóng khi mất focus, nên nút "Đăng nhập" (tài khoản cần đăng nhập lại) trong popup mở trang Cài đặt → Tài khoản
  để chạy đăng nhập ở đó.
- Firefox: add-on chưa ký chỉ cài tạm thời được (xem mục 3b).
- Chế độ "Tất cả tài khoản" tải mỗi trang 25 thư cho **mỗi** tài khoản rồi gộp theo thời gian.
- Lưu nháp khi đóng cửa sổ là best-effort (gửi cho service worker trong `pagehide`); nháp tự động lưu mỗi 10 giây vẫn là lớp chính.
- Editor dùng `document.execCommand` (đã deprecated nhưng vẫn được Chrome hỗ trợ) để tránh phụ thuộc thư viện editor.
- Chuyển tiếp thư giữ lại tệp đính kèm gốc, nhưng không giữ ảnh inline (`cid:`) trong nội dung.
