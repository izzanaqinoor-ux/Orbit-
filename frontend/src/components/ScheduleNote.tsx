import { useEffect, useState } from "react";
import { api } from "../api";
import { usePlanets } from "../planets";
import { usePrefs } from "../prefs";
import { Button, ErrorNote, Field, inputCls, Modal, NumInput } from "./ui";
import { ConflictNote, useConflicts } from "./Conflicts";
import { addDays, endOfDayISO, isAllDay, localInputToISO, startOfDay, toLocalInput, ymd } from "../lib";
import { freeSlot } from "../study/breakdown";
import { useRest } from "../settings";

/**
 * Turn a to-do from Notes into something on the calendar. Either work to fit in somewhere (with an effort and an
 * optional due day, and a suggested time you can accept) or something at a set time. The note is ticked off.
 */
export function ScheduleNote({ text, onClose, onDone }: { text: string; onClose: () => void; onDone: () => void }) {
  const { planets: all } = usePlanets();
  const { on } = usePrefs();
  const planets = on("study") ? all : all.filter((p) => p.kind !== "study");
  const [rest] = useRest();
  const [mode, setMode] = useState<"flexible" | "fixed">("flexible");
  const [title, setTitle] = useState(text.slice(0, 120));
  const [planetId, setPlanetId] = useState(planets.find((p) => p.kind === "personal")?.id ?? planets[0]?.id ?? "");
  const [effort, setEffort] = useState(30);
  const [due, setDue] = useState("");
  const [book, setBook] = useState(true);
  const [start, setStart] = useState(() => { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return toLocalInput(d); });
  const [end, setEnd] = useState(() => { const d = new Date(); d.setHours(d.getHours() + 2, 0, 0, 0); return toLocalInput(d); });
  const [touched, setTouched] = useState(false);
  const [allow, setAllow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Suggest the nearest free gap long enough for the effort (up to two hours at a time), before the due day if there is one.
  useEffect(() => {
    if (touched) return;
    let live = true;
    api.calendar(new Date().toISOString(), addDays(new Date(), 15).toISOString()).then((items) => {
      if (!live) return;
      const busyRows = items.filter((i) => !isAllDay(i.start_at, i.end_at) && i.status !== "cancelled").map((i) => ({ start: new Date(i.start_at).getTime(), end: new Date(i.end_at).getTime() }));
      const mins = Math.max(15, Math.min(effort, 120));
      const last = due ? new Date(due + "T00:00") : addDays(startOfDay(new Date()), 14);
      for (let d = startOfDay(new Date()); d <= last; d = addDays(d, 1)) {
        const at = freeSlot(busyRows, d, mins, { now: Date.now(), dayStartH: rest.before, dayEndH: rest.after });
        if (at !== null) { setStart(toLocalInput(new Date(at))); setEnd(toLocalInput(new Date(at + (mode === "fixed" ? 60 : mins) * 60000))); return; }
      }
    }).catch(() => {});
    return () => { live = false; };
  }, [effort, due, mode, touched, rest.before, rest.after]);

  const s = new Date(start), blockEnd = mode === "flexible" ? new Date(s.getTime() + Math.max(1, Math.min(effort, 120)) * 60000) : new Date(end);
  const checkSlot = mode === "fixed" || book;
  const { clashes, items, next } = useConflicts(checkSlot ? [{ start: s, end: blockEnd }] : []);
  const useTime = (d: Date) => { const len = blockEnd.getTime() - s.getTime(); setTouched(true); setStart(toLocalInput(d)); setEnd(toLocalInput(new Date(d.getTime() + len))); };

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      if (!planetId) throw new Error("Create a planet first.");
      let id: string;
      if (mode === "flexible") {
        const c = await api.createCommitment({ mode: "flexible", title: title.trim(), planet_id: planetId, estimated_duration_minutes: effort, due_at: due ? endOfDayISO(due) : null, due_all_day: !!due });
        id = c.id;
        if (book) await api.addTimeBlock(c.id, new Date(localInputToISO(start)).toISOString(), blockEnd.toISOString());
      } else {
        if (blockEnd <= s) throw new Error("The end must be after the start.");
        const c = await api.createCommitment({ mode: "fixed", title: title.trim(), planet_id: planetId, start_at: localInputToISO(start), end_at: localInputToISO(end) });
        id = c.id;
      }
      void id; onDone(); onClose();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal title="Schedule this" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div className="flex gap-2 text-sm">
          {([["flexible", "Fit it in", "Needs some time, flexible"], ["fixed", "At a set time", "Happens when it happens"]] as const).map(([k, l, h]) => (
            <button type="button" key={k} onClick={() => { setMode(k); setTouched(false); }} className={`flex-1 rounded-lg border px-3 py-2 text-left ${mode === k ? "border-ink bg-surface2" : "border-line text-muted"}`}><span className="block font-medium">{l}</span><span className="text-xs">{h}</span></button>))}
        </div>
        <Field label="What is it?"><input required className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Planet"><select className={inputCls} value={planetId} onChange={(e) => setPlanetId(e.target.value)}>{planets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        {mode === "flexible" ? (<>
          <div className="grid grid-cols-2 gap-3">
            <Field label="How long (minutes)"><NumInput min={5} step={5} required value={effort} onChange={(n) => { setEffort(n); }} /></Field>
            <Field label="Do it by (optional)"><input type="date" className={inputCls} min={ymd(new Date())} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={book} onChange={(e) => setBook(e.target.checked)} /> Book a time for it now</label>
          {book && <Field label={effort > 120 ? "First session (up to 2 hours; plan the rest later)" : "Suggested time"}><input type="datetime-local" required className={inputCls} value={start} onChange={(e) => { setTouched(true); setStart(e.target.value); }} /></Field>}
        </>) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts"><input type="datetime-local" required className={inputCls} value={start} onChange={(e) => { setTouched(true); setStart(e.target.value); }} /></Field>
            <Field label="Ends"><input type="datetime-local" required className={inputCls} value={end} onChange={(e) => { setTouched(true); setEnd(e.target.value); }} /></Field>
          </div>)}
        {checkSlot && <ConflictNote clashes={clashes} items={items} allow={allow} setAllow={setAllow} next={next} onUse={useTime} />}
        <ErrorNote msg={err} />
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !title.trim() || (checkSlot && clashes.length > 0 && !allow)}>{busy ? "Saving…" : "Schedule it"}</Button></div>
      </form>
    </Modal>
  );
}
