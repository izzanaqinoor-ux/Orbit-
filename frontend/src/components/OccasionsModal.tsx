import { useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import { Button, ErrorNote, Field, inputCls, Modal } from "./ui";
import { ymd } from "../lib";

const fmt = (iso: string) => new Date(iso + "T00:00").toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export function OccasionsModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const list = useAsync(() => api.occasions(ymd(new Date()), ymd(new Date(Date.now() + 365 * 86400000))), []);
  const [title, setTitle] = useState("");
  const [on, setOn] = useState(ymd(new Date()));
  const [time, setTime] = useState<string | null>(null);
  const [yearly, setYearly] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await api.addOccasion({ title, occurs_on: on, occurs_time: time ? time + ":00" : null, repeats_yearly: yearly }); setTitle(""); setTime(null); setYearly(false); list.reload(); onDone(); }
    catch (x) { setErr((x as Error).message); }
  };
  const remove = async (id: string) => { try { await api.deleteOccasion(id); list.reload(); onDone(); } catch (x) { setErr((x as Error).message); } };

  return (
    <Modal title="Special occasions" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">Days that don't happen often — a birthday, a dinner, a trip, a deadline you want to see coming. They sit at the top of This week when they're close.</p>
        <ul className="divide-y divide-line">
          {(list.data ?? []).map((o) => (
            <li key={o.id + o.date} className="flex items-center gap-3 py-2">
              <span className="text-sun">◆</span>
              <div className="min-w-0 flex-1"><p className="truncate">{o.title}{o.years ? <span className="ml-2 text-xs text-faint">{o.years} years</span> : null}</p>
                <p className="text-xs text-muted">{fmt(o.date)}{o.time ? ` · ${o.time.slice(0, 5)}` : ""}{o.repeats_yearly ? " · every year" : ""}</p></div>
              <button aria-label="Remove" className="text-faint hover:text-neg" onClick={() => remove(o.id)}>✕</button>
            </li>))}
          {list.data && list.data.length === 0 && <li className="py-3 text-muted">Nothing coming up in the next year.</li>}
        </ul>
        <form onSubmit={add} className="space-y-3 rounded-xl bg-surface2 p-3">
          <Field label="What is it?"><input required className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><input type="date" required className={inputCls} value={on} onChange={(e) => setOn(e.target.value)} /></Field>
            <Field label="Time (optional)"><div className="flex gap-2">{time === null
              ? <button type="button" className="rounded-lg border border-line2 px-3 py-2 text-muted" onClick={() => setTime("19:00")}>Add a time</button>
              : <input type="time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} />}</div></Field>
          </div>
          <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={yearly} onChange={(e) => setYearly(e.target.checked)} /> Happens every year (like a birthday)</label>
          <ErrorNote msg={err} />
          <Button type="submit">Add</Button>
        </form>
      </div>
    </Modal>
  );
}
