import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import { where } from "../lib";
import { ScheduleNote } from "./ScheduleNote";
import type { Note } from "../types";

/** A place to jot a thought the moment it comes. Private by default; "About Orbit" notes also reach whoever maintains the app. */
export function NotesButton({ tab, onChanged }: { tab: string; onChanged?: () => void }) {
  const [sched, setSched] = useState<Note | null>(null);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(tab);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Note["kind"]>("note");
  const [err, setErr] = useState<string | null>(null);
  const list = useAsync(() => api.notes(), []);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  const [notes, setNotes] = useState<Note[]>([]);
  useEffect(() => { if (list.data) setNotes(list.data); }, [list.data]);
  const openCount = notes.filter((n) => !n.done).length;
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!text.trim()) return;
    try { await api.addNote({ text, kind, page: kind === "feedback" ? page : "" }); setText(""); list.reload(); } catch (x) { setErr((x as Error).message); }
  };
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); list.reload(); } catch (x) { setErr((x as Error).message); } };

  return (
    <>
      <button onClick={() => { setPage(tab + (where.sub ? " › " + where.sub : "")); setOpen((o) => !o); }} aria-expanded={open}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-line2 bg-surface px-4 py-2 text-sm text-muted shadow-lg hover:border-ink hover:text-ink">
        Notes{openCount > 0 && <span className="rounded-full bg-sun/25 px-1.5 text-xs text-ink">{openCount}</span>}
      </button>
      {open && (
        <div className="fixed bottom-16 right-4 z-40 flex max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] flex-col rounded-2xl border border-line2 bg-surface shadow-2xl" role="dialog" aria-label="Notes">
          <div className="flex items-center justify-between px-4 pt-3"><h2 className="font-semibold">Notes</h2><button onClick={() => setOpen(false)} aria-label="Close" className="rounded p-1 text-faint hover:text-ink">✕</button></div>
          <form onSubmit={add} className="space-y-2 px-4 pb-3 pt-2">
            <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="A thought, a to-do, something to remember…" className="w-full rounded-lg border border-line2 bg-surface2 px-3 py-2 text-sm outline-none focus:border-ink" />
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1.5 text-xs">
                {([["note", "For me"], ["feedback", "About Orbit"]] as const).map(([k, l]) => <button type="button" key={k} onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 ${kind === k ? "border-ink bg-ink text-bg" : "border-line2 text-muted hover:text-ink"}`}>{l}</button>)}
              </div>
              <button className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-bg hover:bg-ink/85">Add</button>
            </div>
            <p className="text-xs text-faint">{kind === "note" ? "Only you can see this." : `Goes to whoever looks after Orbit, along with where you are (${page}).`}</p>
            {err && <p className="rounded-lg bg-neg/15 px-3 py-2 text-sm text-neg">{err}</p>}
          </form>
          <ul className="divide-y divide-line overflow-y-auto border-t border-line">
            {notes.length === 0 && <li className="px-4 py-5 text-sm text-muted">Nothing yet. Jot something down whenever it comes to you.</li>}
            {notes.map((n) => (
              <li key={n.id} className="group flex items-start gap-3 px-4 py-2.5">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-sun" checked={n.done} onChange={(e) => { const done = e.target.checked; setNotes((xs) => xs.map((x) => (x.id === n.id ? { ...x, done } : x))); act(() => api.patchNote(n.id, { done })); }} aria-label="Done" />
                <div className="min-w-0 flex-1"><p className={`break-words text-sm ${n.done ? "text-faint line-through" : ""}`}>{n.text}</p>
                  {n.kind === "feedback" && <p className="text-xs text-faint">About Orbit{n.page ? ` · ${n.page}` : ""}</p>}</div>
                {n.kind === "note" && !n.done && <button onClick={() => setSched(n)} className="whitespace-nowrap rounded-md border border-line2 px-2 py-0.5 text-xs text-muted hover:border-ink hover:text-ink">Schedule</button>}
                <button onClick={() => act(() => api.deleteNote(n.id))} className="text-xs text-faint opacity-60 hover:text-neg hover:opacity-100" aria-label="Delete note">✕</button>
              </li>))}
          </ul>
          {notes.some((n) => n.done) && <button className="border-t border-line px-4 py-2 text-left text-xs text-muted hover:text-ink" onClick={() => act(async () => { for (const n of notes.filter((x) => x.done)) await api.deleteNote(n.id); })}>Clear done</button>}
        </div>)}
      {sched && <ScheduleNote text={sched.text} onClose={() => setSched(null)} onDone={() => { const n = sched; setNotes((xs) => xs.map((x) => (x.id === n.id ? { ...x, done: true } : x))); act(() => api.patchNote(n.id, { done: true })); onChanged?.(); }} />}
    </>
  );
}
