/**
 * Editor rich text tối giản (contentEditable): đậm, nghiêng, link, danh sách.
 * Dán (paste) luôn chỉ lấy văn bản thuần — không đưa HTML lạ vào trang extension.
 */
import { useEffect, useRef } from 'preact/hooks';
import { cleanFragment, cleanNode, fragmentToEmailHtml, textToNodes } from '../lib/html-clean';

export interface EditorHandle {
  getHtml(): string;
  getText(): string;
  setContent(frag: DocumentFragment): void;
  /** Chèn HTML (sẽ được lọc whitelist) tại con trỏ hoặc cuối nội dung. */
  insertHtml(html: string): void;
  focus(): void;
}

interface EditorProps {
  handle: { current: EditorHandle | null };
  onChange: () => void;
  /** Nội dung ban đầu (được lọc whitelist), chỉ nạp khi mount. */
  initialHtml?: string;
}

export function RichEditor({ handle, onChange, initialHtml }: EditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lastRange = useRef<Range | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (initialHtml && !el.hasChildNodes()) el.replaceChildren(cleanFragment(initialHtml));
    handle.current = {
      getHtml: () => fragmentToEmailHtml(cleanNode(el)),
      getText: () => el.innerText.replace(/\n{3,}/g, '\n\n'),
      setContent: (frag) => {
        el.replaceChildren(frag);
      },
      insertHtml: (html) => {
        const frag = cleanFragment(html);
        const range = lastRange.current;
        if (range && el.contains(range.startContainer)) {
          range.deleteContents();
          range.insertNode(frag);
          range.collapse(false);
        } else {
          el.prepend(frag);
        }
        onChange();
      },
      focus: () => el.focus(),
    };
    const saveRange = () => {
      const sel = document.getSelection();
      if (sel?.rangeCount && el.contains(sel.anchorNode)) lastRange.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', saveRange);
    return () => document.removeEventListener('selectionchange', saveRange);
  }, [handle, onChange]);

  const exec = (cmd: string, value?: string) => {
    ref.current?.focus();
    // execCommand đã deprecated nhưng vẫn là cách đơn giản, không phụ thuộc thư viện, để định dạng contentEditable.
    document.execCommand(cmd, false, value);
    onChange();
  };

  const addLink = () => {
    const url = prompt('Địa chỉ liên kết (https://…)', 'https://');
    if (!url) return;
    if (!/^(https?:|mailto:)/i.test(url.trim())) {
      alert('Chỉ hỗ trợ liên kết http(s) hoặc mailto.');
      return;
    }
    exec('createLink', url.trim());
  };

  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const sel = document.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const lines = text.split(/\r?\n/);
    if (lines.length === 1) {
      range.insertNode(document.createTextNode(text));
    } else {
      range.insertNode(textToNodes(text));
    }
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    onChange();
  };

  return (
    <div class="editor-wrap">
      <div class="row editor-toolbar" role="toolbar">
        <button type="button" class="ghost icon" title="Đậm (Ctrl+B)" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>
          <b>B</b>
        </button>
        <button type="button" class="ghost icon" title="Nghiêng (Ctrl+I)" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>
          <i>I</i>
        </button>
        <button type="button" class="ghost" title="Chèn liên kết" onMouseDown={(e) => e.preventDefault()} onClick={addLink}>
          Link
        </button>
        <button type="button" class="ghost" title="Danh sách gạch đầu dòng" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')}>
          • Danh sách
        </button>
        <button type="button" class="ghost" title="Danh sách đánh số" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')}>
          1. Danh sách
        </button>
      </div>
      <div
        ref={ref}
        class="editor"
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label="Nội dung thư"
        onInput={onChange}
        onPaste={onPaste}
        onDrop={(e) => e.preventDefault()}
      />
    </div>
  );
}
