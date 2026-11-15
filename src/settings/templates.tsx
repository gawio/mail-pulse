import { useRef, useState } from 'preact/hooks';
import { cleanHtmlString } from '../lib/html-clean';
import { updateLocal, type Template } from '../lib/storage';
import { BUILTIN_VARS, exportTemplates, extractVariables, parseTemplateImport } from '../lib/templates';
import { errorText, useLocal } from '../shared/components';
import { RichEditor, type EditorHandle } from '../shared/editor';

function TemplateForm({ initial, onDone }: { initial: Template; onDone: () => void }) {
  const accounts = useLocal('accounts') ?? [];
  const [name, setName] = useState(initial.name);
  const [subject, setSubject] = useState(initial.subject);
  const [accountId, setAccountId] = useState(initial.accountId ?? '');
  const editor = useRef<EditorHandle | null>(null);
  const [vars, setVars] = useState<string[]>(extractVariables(initial.subject, initial.body));

  const refreshVars = () => setVars(extractVariables(subject, editor.current?.getHtml() ?? ''));

  const save = async () => {
    if (!name.trim()) return alert('Template cần có tên.');
    const t: Template = { id: initial.id, name: name.trim(), subject, body: editor.current?.getHtml() ?? '', accountId: accountId || undefined };
    await updateLocal('templates', (list) => (list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t]));
    onDone();
  };

  return (
    <div class="card col template-form">
      <div class="field">
        <span>Tên</span>
        <input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="vd: Xác nhận lịch họp" />
      </div>
      <div class="field">
        <span>Tiêu đề thư</span>
        <input
          value={subject}
          onInput={(e) => {
            setSubject(e.currentTarget.value);
          }}
          onBlur={refreshVars}
          placeholder="vd: Lịch họp ngày {{date}}"
        />
      </div>
      <div class="field">
        <span>Tài khoản mặc định</span>
        <select value={accountId} onChange={(e) => setAccountId(e.currentTarget.value)}>
          <option value="">(Không)</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.email}
            </option>
          ))}
        </select>
      </div>
      <div class="template-editor">
        <RichEditor handle={editor} onChange={refreshVars} initialHtml={initial.body} />
      </div>
      <p class="muted small">
        Biến có sẵn: {BUILTIN_VARS.map((v) => `{{${v}}}`).join(', ')} (tên/email người nhận đầu tiên, ngày hôm nay). Bạn có thể tự đặt biến bất kỳ,
        vd {'{{công_ty}}'} — khi chèn, Mail Pulse sẽ hỏi giá trị.
      </p>
      {vars.length > 0 && <p class="small">Biến trong template: {vars.map((v) => `{{${v}}}`).join(', ')}</p>}
      <div class="row">
        <button class="primary" onClick={() => void save()}>
          Lưu
        </button>
        <button onClick={onDone}>Huỷ</button>
      </div>
    </div>
  );
}

export function TemplatesSection() {
  const templates = useLocal('templates');
  const accounts = useLocal('accounts') ?? [];
  const [editing, setEditing] = useState<Template | null>(null);
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const doExport = () => {
    const blob = new Blob([exportTemplates(templates ?? [])], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mail-pulse-templates-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const doImport = async (file: File) => {
    setMessage('');
    try {
      const list = parseTemplateImport(
        await file.text(),
        accounts.map((a) => a.id),
        cleanHtmlString,
        () => crypto.randomUUID(),
      );
      await updateLocal('templates', (cur) => [...cur, ...list]);
      setMessage(`Đã nhập ${list.length} template.`);
    } catch (e) {
      setMessage(`Import lỗi: ${errorText(e)}`);
    }
  };

  if (!templates) return null;
  return (
    <section class="col">
      <h2>Template</h2>
      {message && <div class="banner">{message}</div>}
      {editing ? (
        <TemplateForm key={editing.id} initial={editing} onDone={() => setEditing(null)} />
      ) : (
        <>
          {templates.length === 0 && <p class="muted">Chưa có template nào.</p>}
          {templates.map((t) => (
            <div class="card row" key={t.id}>
              <div class="grow">
                <strong>{t.name}</strong>
                <div class="muted small ellipsis">{t.subject || '(không tiêu đề)'}</div>
                {t.accountId && <div class="muted small">Mặc định: {accounts.find((a) => a.id === t.accountId)?.email}</div>}
              </div>
              <button onClick={() => setEditing(t)}>Sửa</button>
              <button
                class="danger"
                onClick={() => {
                  if (confirm(`Xoá template "${t.name}"?`)) void updateLocal('templates', (l) => l.filter((x) => x.id !== t.id));
                }}
              >
                Xoá
              </button>
            </div>
          ))}
          <div class="row">
            <button class="primary" onClick={() => setEditing({ id: crypto.randomUUID(), name: '', subject: '', body: '' })}>
              + Template mới
            </button>
            <span class="spacer" />
            <button onClick={() => fileInput.current?.click()}>Import JSON</button>
            <button onClick={doExport} disabled={!templates.length}>
              Export JSON
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              class="hidden"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) void doImport(f);
                e.currentTarget.value = '';
              }}
            />
          </div>
        </>
      )}
    </section>
  );
}
