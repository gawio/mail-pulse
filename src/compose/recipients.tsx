/** Ô nhập người nhận (phân tách bằng dấu phẩy) với gợi ý từ các địa chỉ đã thấy trong phiên. */
import { useMemo, useState } from 'preact/hooks';

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  autoFocus?: boolean;
}

export function RecipientInput({ label, value, onChange, suggestions, autoFocus }: Props) {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);

  const token = value.split(',').pop()?.trim().toLowerCase() ?? '';
  const matches = useMemo(() => {
    if (token.length < 1) return [];
    const already = new Set(value.toLowerCase().split(',').map((s) => s.trim()));
    return suggestions.filter((s) => s.toLowerCase().includes(token) && !already.has(s.toLowerCase())).slice(0, 6);
  }, [token, value, suggestions]);

  const pick = (s: string) => {
    const parts = value.split(',');
    parts[parts.length - 1] = ` ${s}`;
    onChange(`${parts.join(',').replace(/^\s+/, '')}, `);
    setActive(0);
  };

  return (
    <div class="field-row recipient">
      <label class="field-label">{label}</label>
      <div class="grow suggest-wrap">
        <input
          class="full"
          value={value}
          autoFocus={autoFocus}
          autocomplete="off"
          spellcheck={false}
          onInput={(e) => {
            onChange(e.currentTarget.value);
            setActive(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (!matches.length) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => (a + 1) % matches.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => (a - 1 + matches.length) % matches.length);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              const m = matches[active];
              if (m) {
                e.preventDefault();
                pick(m);
              }
            }
          }}
        />
        {focused && matches.length > 0 && (
          <ul class="suggestions" role="listbox">
            {matches.map((m, i) => (
              <li key={m} role="option" aria-selected={i === active} onMouseDown={(e) => (e.preventDefault(), pick(m))}>
                {m}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
