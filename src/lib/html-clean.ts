/**
 * Lọc HTML theo whitelist cho nội dung do người dùng soạn (editor, template, template import).
 * Dựng lại cây DOM bằng createElement/textContent — không dùng innerHTML.
 */
const ALLOWED_TAGS = new Set(['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'span', 'pre', 'code']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'head', 'title', 'template', 'iframe', 'object', 'embed', 'svg', 'math', 'noscript']);

function safeHref(href: string): string | null {
  const h = href.trim();
  return /^(https?:|mailto:)/i.test(h) ? h : null;
}

function copyClean(src: Node, doc: Document, out: Node): void {
  for (const child of src.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.appendChild(doc.createTextNode(child.textContent ?? ''));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) continue;
    if (!ALLOWED_TAGS.has(tag)) {
      // Thẻ lạ: giữ nội dung, bỏ thẻ.
      copyClean(el, doc, out);
      continue;
    }
    const clone = doc.createElement(tag);
    if (tag === 'a') {
      const href = safeHref(el.getAttribute('href') ?? '');
      if (href) {
        clone.setAttribute('href', href);
        clone.setAttribute('target', '_blank');
        clone.setAttribute('rel', 'noopener noreferrer');
      }
    }
    copyClean(el, doc, clone);
    out.appendChild(clone);
  }
}

/** Trả về DocumentFragment đã lọc, thuộc `targetDoc`. */
export function cleanFragment(html: string, targetDoc: Document = document): DocumentFragment {
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  const frag = targetDoc.createDocumentFragment();
  copyClean(parsed.body, targetDoc, frag);
  return frag;
}

/** Lọc một node đang có trong DOM (vd. editor) -> fragment sạch. */
export function cleanNode(node: Node, targetDoc: Document = document): DocumentFragment {
  const frag = targetDoc.createDocumentFragment();
  copyClean(node, targetDoc, frag);
  return frag;
}

/** Serialize fragment sạch thành HTML để gửi đi (thêm style inline cho blockquote). */
export function fragmentToEmailHtml(frag: DocumentFragment): string {
  const doc = document.implementation.createHTMLDocument('');
  const wrap = doc.createElement('div');
  wrap.appendChild(doc.importNode(frag, true));
  wrap.querySelectorAll('blockquote').forEach((b) => b.setAttribute('style', 'margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex'));
  return wrap.innerHTML;
}

export function cleanHtmlString(html: string): string {
  return fragmentToEmailHtml(cleanFragment(html));
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** Văn bản thuần -> các node <div> (mỗi dòng một div, dòng trống là <br>). */
export function textToNodes(text: string, doc: Document = document): DocumentFragment {
  const frag = doc.createDocumentFragment();
  for (const line of text.split(/\r?\n/)) {
    const div = doc.createElement('div');
    if (line) div.textContent = line;
    else div.appendChild(doc.createElement('br'));
    frag.appendChild(div);
  }
  return frag;
}
