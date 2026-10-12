import { useEffect, useRef, useState } from "react";

/** A small planet in the corner; the account actions live behind it. */
export function AccountMenu({ items }: { items: { label: string; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down); window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); window.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Account menu" aria-haspopup="menu" aria-expanded={open}
        className={`flex h-9 w-9 items-center justify-center rounded-full border transition ${open ? "border-ink bg-surface2" : "border-line2 hover:border-ink"}`}>
        <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden="true">
          <ellipse cx="16" cy="17" rx="14" ry="4.2" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-muted" transform="rotate(-18 16 17)" />
          <circle cx="16" cy="16" r="7" className="fill-sun" />
          <path d="M9.4 18.6c4 1.8 9.6 1 13.2-1.6" stroke="#000" strokeOpacity=".18" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-50 w-52 overflow-hidden rounded-xl border border-line2 bg-surface py-1 shadow-xl">
          {items.map((it) => (
            <button key={it.label} role="menuitem" onClick={() => { setOpen(false); it.onClick(); }} className="block w-full px-4 py-2.5 text-left text-sm text-muted hover:bg-surface2 hover:text-ink">{it.label}</button>))}
        </div>)}
    </div>
  );
}
