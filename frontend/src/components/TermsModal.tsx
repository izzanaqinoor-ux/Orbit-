import { useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import { Button, ErrorNote, Field, inputCls, Modal } from "./ui";

const fmt = (d: string) => new Date(d + "T00:00").toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

export function TermsModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const info = useAsync(() => api.terms(), []);
  const [kind, setKind] = useState<"term" | "break">("term");
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!start || !end) return setErr("Pick a start and an end date.");
    try { await api.addTerm({ kind, name, start_date: start, end_date: end }); setName(""); setStart(""); setEnd(""); info.reload(); onDone(); }
    catch (x) { setErr((x as Error).message); }
  };
  const remove = async (id: string) => { try { await api.deleteTerm(id); info.reload(); onDone(); } catch (x) { setErr((x as Error).message); } };

  return (
    <Modal title="Calendar periods" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">Mark stretches of time that feel different — a semester, a busy season, a holiday, leave. Busy periods tint the calendar blue, time off tints it sand, and income can be set to count only in one or the other. Orbit reminds you when nothing is planned ahead.</p>
        {info.data?.message && <p className="rounded-lg bg-warn/10 px-3 py-2 text-warn">{info.data.message}</p>}
        <ul className="divide-y divide-line">
          {(info.data?.terms ?? []).map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2">
              <span className={`h-3 w-3 shrink-0 rounded-full ${t.kind === "term" ? "bg-term" : "bg-break"}`} />
              <div className="min-w-0 flex-1"><p className="truncate">{t.name}</p><p className="text-xs text-muted">{fmt(t.start_date)} – {fmt(t.end_date)}</p></div>
              <button aria-label="Remove" className="text-faint hover:text-neg" onClick={() => remove(t.id)}>✕</button>
            </li>
          ))}
          {info.data && info.data.terms.length === 0 && <li className="py-3 text-muted">Nothing entered yet.</li>}
        </ul>
        <form onSubmit={add} className="space-y-3 rounded-xl bg-surface2 p-3">
          <div className="flex gap-1.5">
            {(["term", "break"] as const).map((k) => (
              <button type="button" key={k} onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 ${kind === k ? "border-ink bg-ink text-bg" : "border-line2 text-muted"}`}>{k === "term" ? "Busy period" : "Time off"}</button>
            ))}
          </div>
          <Field label="Name (optional)"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "term" ? "Semester, busy season, project…" : "Holiday, leave, rest…"} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First day"><input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Last day"><input type="date" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
          <ErrorNote msg={err} />
          <Button type="submit">Add</Button>
        </form>
      </div>
    </Modal>
  );
}
