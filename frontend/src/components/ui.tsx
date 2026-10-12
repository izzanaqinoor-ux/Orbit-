import { useEffect, useRef, useState, type ReactNode } from "react";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className={`max-h-[90vh] w-full ${wide ? "max-w-2xl" : "max-w-md"} overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-faint hover:text-ink">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Card = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <section className={`rounded-2xl border border-line bg-surface p-5 ${className}`}>{children}</section>
);

export const Button = ({ variant = "primary", className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) => (
  <button
    {...p}
    className={`rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50 ${
      variant === "primary" ? "bg-ink text-bg hover:bg-ink/85"
      : variant === "danger" ? "text-neg hover:bg-neg/15"
      : "text-muted hover:bg-surface2"} ${className}`}
  />
);

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block text-sm"><span className="mb-1 block font-medium text-muted">{label}</span>{children}</label>
);
export const inputCls = "w-full rounded-lg border border-line2 bg-surface2 px-3 py-2 text-sm outline-none focus:border-ink";

/**
 * A number box that behaves: clearing it leaves it empty (not a stuck 0), and typing after a 0 gives 50, never 050.
 * `scale` lets money live as cents while the box shows dollars.
 */
export function NumInput({ value, onChange, scale = 1, className = inputCls, ...rest }: {
  value: number | null; onChange: (n: number) => void; scale?: number; className?: string;
  min?: number; max?: number; step?: number | string; required?: boolean; placeholder?: string; disabled?: boolean;
}) {
  const show = (v: number | null) => (v == null ? "" : String(+(v / scale).toFixed(6)));
  const [text, setText] = useState(show(value));
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { last.current = value; setText(show(value)); } }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input {...rest} type="number" inputMode="decimal" className={className} value={text}
      onChange={(e) => {
        const raw = e.target.value.replace(/^(-?)0+(?=\d)/, "$1");
        setText(raw);
        const n = raw === "" || raw === "-" ? 0 : parseFloat(raw);
        if (!isNaN(n)) { const v = Math.round(n * scale); last.current = v; onChange(v); }
      }}
      onBlur={() => setText(show(last.current))} />
  );
}

export const ErrorNote = ({ msg }: { msg: string | null }) => msg ? <p className="rounded-lg bg-neg/15 px-3 py-2 text-sm text-neg">{msg}</p> : null;
