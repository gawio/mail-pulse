/** Chọn template khi soạn thư; nếu thiếu giá trị biến thì hiện form điền. */
import { useState } from 'preact/hooks';
import { parseAddressList } from '../lib/address';
import type { Template } from '../lib/storage';
import { extractVariables, formatToday, missingVariables } from '../lib/templates';
import { Modal, useLocal } from '../shared/components';
import { openSettings } from '../shared/messages';

const LABELS: Record<string, string> = { name: 'Tên người nhận', email: 'Email người nhận', date: 'Ngày' };

interface Props {
  to: string;
  onApply: (t: Template, values: Record<string, string>) => void;
}

export function TemplatePicker({ to, onApply }: Props) {
  const templates = useLocal('templates') ?? [];
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ t: Template; values: Record<string, string>; missing: string[] } | null>(null);

  const choose = (t: Template) => {
    const first = parseAddressList(to)[0];
    const known: Record<string, string> = { name: first?.name ?? '', email: first?.email ?? '', date: formatToday() };
    const vars = extractVariables(t.subject, t.body);
    const values: Record<string, string> = {};
    for (const v of vars) values[v] = known[v] ?? '';
    const missing = missingVariables(vars, values);
    setOpen(false);
    if (missing.length) setPending({ t, values, missing });
    else onApply(t, values);
  };

  return (
    <>
      <button onClick={() => setOpen(true)}>Template</button>
      {open && (
        <Modal title="Chèn template" onClose={() => setOpen(false)}>
          <div class="col">
            {templates.length === 0 && <p class="muted">Chưa có template. Tạo trong Cài đặt → Template.</p>}
            {templates.map((t) => (
              <button key={t.id} class="template-option" onClick={() => choose(t)}>
                <strong>{t.name}</strong>
                <span class="muted small ellipsis">{t.subject}</span>
              </button>
            ))}
            <div class="row">
              <button class="ghost" onClick={() => openSettings('templates')}>
                Quản lý template…
              </button>
              <span class="spacer" />
              <button onClick={() => setOpen(false)}>Đóng</button>
            </div>
          </div>
        </Modal>
      )}
      {pending && (
        <Modal title={`Điền biến — ${pending.t.name}`} onClose={() => setPending(null)}>
          <form
            class="col"
            onSubmit={(e) => {
              e.preventDefault();
              onApply(pending.t, pending.values);
              setPending(null);
            }}
          >
            {pending.missing.map((v, i) => (
              <label key={v} class="col var-field">
                <span class="small muted">{LABELS[v] ?? v}</span>
                <input
                  autoFocus={i === 0}
                  value={pending.values[v]}
                  onInput={(e) => setPending({ ...pending, values: { ...pending.values, [v]: e.currentTarget.value } })}
                />
              </label>
            ))}
            <div class="row">
              <span class="spacer" />
              <button type="button" onClick={() => setPending(null)}>
                Huỷ
              </button>
              <button type="submit" class="primary">
                Chèn
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
