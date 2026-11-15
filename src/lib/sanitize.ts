/**
 * Chuẩn bị HTML mail để hiển thị trong <iframe sandbox srcdoc> (không allow-scripts).
 *
 * Nhiều lớp bảo vệ:
 *  1. iframe sandbox không có allow-scripts / allow-forms.
 *  2. CSP riêng trong <meta> của tài liệu: default-src 'none', mặc định chặn mọi ảnh/font/CSS remote.
 *  3. Lọc DOM: bỏ script/iframe/object/embed/link/meta/base/form controls, thuộc tính on*, URL javascript:.
 *  4. Ảnh remote: chuyển src -> data-mp-src (không tải) cho tới khi người dùng bấm "Hiện ảnh".
 *  5. Link: target=_blank, rel="noopener noreferrer".
 *
 * Chỉ dùng DOMParser (tài liệu trơ, không thực thi). Không dùng innerHTML trên trang extension.
 */

const DROP_TAGS = ['script', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base', 'form', 'input', 'button', 'select', 'textarea', 'template', 'portal', 'svg script'];
const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'xlink:href', 'background', 'poster', 'srcset', 'data', 'ping', 'lowsrc'];
const REMOTE_RE = /^\s*(https?:)?\/\//i;
const CSS_REMOTE_URL_RE = /url\(\s*['"]?\s*(https?:)?\/\//i;

export interface SanitizeOptions {
  allowRemoteImages: boolean;
  /** cid -> data: URL cho ảnh inline */
  cidMap?: Record<string, string>;
  dark?: boolean;
}

export interface SanitizeResult {
  html: string;
  hasRemoteImages: boolean;
}

function isSafeHref(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('mailto:') || s.startsWith('#');
}

function cspFor(allowRemote: boolean): string {
  const img = allowRemote ? "data: https: http:" : 'data:';
  return `default-src 'none'; img-src ${img}; style-src 'unsafe-inline'; font-src data:; media-src 'none'; form-action 'none'; base-uri 'none'`;
}

const BASE_STYLE = `
html,body{margin:0;padding:0;}
body{padding:10px 12px;font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;word-wrap:break-word;overflow-wrap:anywhere;}
img{max-width:100%;height:auto;}
table{max-width:100%;}
pre{white-space:pre-wrap;}
blockquote{margin:0 0 0 8px;padding-left:10px;border-left:3px solid #ccc;}
img[data-mp-blocked]{display:inline-block;min-width:16px;min-height:16px;background:repeating-linear-gradient(45deg,#eee,#eee 4px,#f8f8f8 4px,#f8f8f8 8px);}
`;

function finalize(doc: Document, allowRemote: boolean, extraStyle = ''): string {
  const head = doc.head;
  while (head.firstChild) head.firstChild.remove();
  const meta = doc.createElement('meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', cspFor(allowRemote));
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  const referrer = doc.createElement('meta');
  referrer.setAttribute('name', 'referrer');
  referrer.setAttribute('content', 'no-referrer');
  const style = doc.createElement('style');
  style.textContent = BASE_STYLE + extraStyle;
  head.prepend(charset, meta, referrer, style);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

export function sanitizeEmailHtml(html: string, opts: SanitizeOptions): SanitizeResult {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let hasRemote = false;

  // Giữ lại <style> của mail (nằm trong head) bằng cách chuyển vào body trước khi xoá head.
  const styles = [...doc.querySelectorAll('style')];
  for (const s of styles) {
    const css = s.textContent ?? '';
    if (/@import/i.test(css) || CSS_REMOTE_URL_RE.test(css)) hasRemote = true;
    s.textContent = css.replace(/@import[^;]+;?/gi, '');
    doc.body.prepend(s);
  }

  for (const sel of DROP_TAGS) doc.querySelectorAll(sel).forEach((n) => n.remove());

  for (const el of [...doc.body.querySelectorAll('*'), doc.body]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'style' && CSS_REMOTE_URL_RE.test(attr.value)) hasRemote = true;
      if (URL_ATTRS.includes(name)) {
        const v = attr.value.trim();
        if (/^\s*(javascript|vbscript|data:text|file):/i.test(v)) el.removeAttribute(attr.name);
      }
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? '';
      if (href && !isSafeHref(href)) el.removeAttribute('href');
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    } else if (tag === 'img' || tag === 'source' || tag === 'video' || tag === 'audio' || tag === 'input') {
      const src = el.getAttribute('src') ?? '';
      el.removeAttribute('srcset');
      if (src.toLowerCase().startsWith('cid:')) {
        const data = opts.cidMap?.[src.slice(4)];
        if (data) el.setAttribute('src', data);
        else el.removeAttribute('src');
      } else if (REMOTE_RE.test(src)) {
        hasRemote = true;
        if (!opts.allowRemoteImages) {
          el.setAttribute('data-mp-src', src);
          el.setAttribute('data-mp-blocked', '');
          el.removeAttribute('src');
        } else if (src.startsWith('//')) el.setAttribute('src', `https:${src}`);
      }
    } else if (el.hasAttribute('background')) {
      hasRemote = hasRemote || REMOTE_RE.test(el.getAttribute('background') ?? '');
      if (!opts.allowRemoteImages) el.removeAttribute('background');
    }
  }

  return { html: finalize(doc, opts.allowRemoteImages), hasRemoteImages: hasRemote };
}

/** Văn bản thuần -> tài liệu HTML an toàn (text node + link tự động), dùng khi mail không có phần html. */
export function plainTextDocument(text: string, dark: boolean): string {
  const doc = document.implementation.createHTMLDocument('');
  const pre = doc.createElement('pre');
  const re = /\bhttps?:\/\/[^\s<>"')\]]+/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    pre.append(text.slice(last, m.index));
    const a = doc.createElement('a');
    a.href = m[0];
    a.textContent = m[0];
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    pre.append(a);
    last = (m.index ?? 0) + m[0].length;
  }
  pre.append(text.slice(last));
  pre.style.fontFamily = 'inherit';
  pre.style.margin = '0';
  doc.body.append(pre);
  const colors = dark ? 'body{background:#16181d;color:#e6e8ec;} a{color:#8fb3ff;}' : 'body{background:#fff;color:#1d2129;}';
  return finalize(doc, false, colors);
}
