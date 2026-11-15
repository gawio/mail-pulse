import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getLocal, onStorageChange, type Account, type LocalKey, type LocalSchema } from '../lib/storage';

/** Hook đọc một key storage.local và tự cập nhật khi đổi. */
export function useLocal<K extends LocalKey>(key: K): LocalSchema[K] | undefined {
  const [value, setValue] = useState<LocalSchema[K] | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void getLocal(key).then((v) => alive && setValue(() => v));
    const off = onStorageChange('local', key, (v) => alive && setValue(() => v as LocalSchema[K]));
    return () => {
      alive = false;
      off();
    };
  }, [key]);
  return value;
}

export function Avatar({ account, size = 28 }: { account: Pick<Account, 'email' | 'name' | 'picture' | 'color'>; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: `${size}px`, height: `${size}px` };
  if (account.picture && !broken) {
    return <img class="avatar" style={style} src={account.picture} alt="" referrerpolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return (
    <span class="avatar" style={{ ...style, background: account.color }}>
      {(account.name || account.email).charAt(0).toUpperCase()}
    </span>
  );
}

export function Spinner() {
  return <span class="spinner" role="status" aria-label="Đang tải" />;
}

export interface ToastState {
  text: string;
  action?: { label: string; run: () => void };
  ms?: number;
}

/** Toast một dòng, tự ẩn (mặc định 5 giây). */
export function useToast(): [ToastState | null, (t: ToastState | null) => void] {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number>();
  const show = (t: ToastState | null) => {
    window.clearTimeout(timer.current);
    setToast(t);
    if (t) timer.current = window.setTimeout(() => setToast(null), t.ms ?? 5000);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [toast, show];
}

export function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  if (!toast) return null;
  return (
    <div class="toast" role="status">
      <span>{toast.text}</span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action?.run();
            onClose();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button class="icon" aria-label="Đóng" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ComponentChildren; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
