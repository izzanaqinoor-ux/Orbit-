import { useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import { usePlanets } from "../planets";
import { usePrefs } from "../prefs";
import { Button, ErrorNote, Field, inputCls, Modal, NumInput } from "./ui";
import { ConflictNote, useConflicts } from "./Conflicts";
import { addDays, endOfDayISO, isAllDay, localInputToISO, toLocalInput, ymd } from "../lib";
import { splitOccurrence } from "../occurrence";
import type { CalendarItem, Commitment } from "../types";

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const withTime = (d: Date, t: string) => { const [h, m] = t.split(":").map(Number); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m); };

/** Edit a commitment in place: title, planet, times (fixed) or effort and due date (flexible). */
export function EditCommitment({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const all = useAsync(() => api.commitments(), [id]);
  const c = all.data?.find((x) => x.id === id) ?? null;
  return (
    <Modal title="Edit" onClose={onClose}>
      {!c ? <p className="text-sm text-muted">{all.error ?? "Loading…"}</p> : <Body c={c} onClose={onClose} onDone={onDone} />}
    </Modal>
  );
}

function Body({ c, onClose, onDone }: { c: Commitment; onClose: () => void; onDone: () => void }) {
  const { planets: allPlanets } = usePlanets();
  const { on } = usePrefs();
  const planets = on("study") ? allPlanets : allPlanets.filter((p) => p.kind !== "study" || p.id === c.planet_id);
  const fixed = c.mode === "fixed", repeats = !!c.recurrence_rule;
  const s0 = c.start_at ? new Date(c.start_at) : null, e0 = c.end_at ? new Date(c.end_at) : null;
  const allDay = fixed && !repeats && !!c.start_at && !!c.end_at && isAllDay(c.start_at, c.end_at);

  const [title, setTitle] = useState(c.title);
  const [planetId, setPlanetId] = useState(c.planet_id ?? planets[0]?.id ?? "");
  const [notes, setNotes] = useState(c.description ?? "");
  const [start, setStart] = useState(s0 ? toLocalInput(s0) : "");
  const [end, setEnd] = useState(e0 ? toLocalInput(e0) : "");
  const [t1, setT1] = useState(s0 ? hhmm(s0) : "09:00");
  const [t2, setT2] = useState(e0 ? hhmm(e0) : "10:00");
  const [dFrom, setDFrom] = useState(s0 ? ymd(s0) : "");
  const [dTo, setDTo] = useState(e0 ? ymd(addDays(e0, -1)) : "");
  const [effort, setEffort] = useState(c.estimated_duration_minutes ?? 0);
  const dueD = c.due_at ? new Date(c.due_at) : null;
  const [due, setDue] = useState(dueD ? ymd(dueD) : "");
  const [dueTime, setDueTime] = useState<string | null>(dueD && !c.due_all_day ? hhmm(dueD) : null);
  const [timeOff, setTimeOff] = useState(!!c.time_off);
  const [allow, setAllow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slots = fixed && !repeats && !allDay && start && end ? [{ start: new Date(start), end: new Date(end) }] : [];
  const { clashes, items } = useConflicts(slots, (i) => i.commitment_id === c.id);
  const blocked = clashes.length > 0 && !allow;

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const patch: Parameters<typeof api.updateCommitment>[1] = { title, planet_id: planetId || undefined };
      if (fixed) {
        if (allDay) {
          const a = new Date(dFrom + "T00:00"), b = addDays(new Date(dTo + "T00:00"), 1);
          if (b <= a) throw new Error("The last day is before the first day.");
          patch.start_at = a.toISOString(); patch.end_at = b.toISOString(); patch.time_off = timeOff;
        } else if (repeats) {
          if (t2 <= t1) throw new Error("The end time must be after the start time.");
          patch.start_at = withTime(s0!, t1).toISOString(); patch.end_at = withTime(s0!, t2).toISOString();
        } else {
          patch.start_at = localInputToISO(start); patch.end_at = localInputToISO(end);
        }
      } else {
        patch.estimated_duration_minutes = effort;
        patch.description = notes.trim() ? notes : null;
        patch.due_at = due ? (dueTime ? localInputToISO(`${due}T${dueTime}`) : endOfDayISO(due)) : null;
        patch.due_all_day = !!due && dueTime === null;
      }
      await api.updateCommitment(c.id, patch);
      onDone(); onClose();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <Field label="Title"><input required autoFocus className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Planet">
        <select className={inputCls} value={planetId} onChange={(e) => setPlanetId(e.target.value)}>{planets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </Field>
      {fixed ? (allDay ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day"><input type="date" required className={inputCls} value={dFrom} onChange={(e) => { setDFrom(e.target.value); if (dTo < e.target.value) setDTo(e.target.value); }} /></Field>
          <Field label="Last day"><input type="date" required className={inputCls} min={dFrom} value={dTo} onChange={(e) => setDTo(e.target.value)} /></Field>
          <label className="col-span-2 flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={timeOff} onChange={(e) => setTimeOff(e.target.checked)} /> This is time off (highlighted across these days)</label>
        </div>
      ) : repeats ? (<>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input type="time" required className={inputCls} value={t1} onChange={(e) => setT1(e.target.value)} /></Field>
          <Field label="To"><input type="time" required className={inputCls} value={t2} onChange={(e) => setT2(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-muted">This changes every repeat, except any you've already changed on their own.</p>
      </>) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts"><input type="datetime-local" required className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Ends"><input type="datetime-local" required className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
      )) : (<>
        <Field label="Estimated effort (minutes)"><NumInput min={0} step={5} required value={effort} onChange={setEffort} /></Field>
        <Field label="Due on (optional)">
          <div className="flex gap-2">
            <input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />
            {due && dueTime !== null && <input type="time" className={inputCls + " max-w-32"} value={dueTime} onChange={(e) => setDueTime(e.target.value)} />}
          </div>
        </Field>
        {due && <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={dueTime !== null} onChange={(e) => setDueTime(e.target.checked ? "09:00" : null)} /> It has a set time, not just a day</label>}
        <Field label="Notes"><textarea rows={4} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </>)}
      {fixed && <ConflictNote clashes={clashes} items={items} allow={allow} setAllow={setAllow} />}
      <ErrorNote msg={err} />
      <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || blocked}>{busy ? "Saving…" : "Save"}</Button></div>
    </form>
  );
}

/** Edit a block of planned time: when it starts and how long it is. */
export function EditBlock({ item, onClose, onDone }: { item: CalendarItem; onClose: () => void; onDone: () => void }) {
  const s0 = new Date(item.start_at), e0 = new Date(item.end_at);
  const [start, setStart] = useState(toLocalInput(s0));
  const [mins, setMins] = useState(Math.round((e0.getTime() - s0.getTime()) / 60000));
  const [allow, setAllow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const a = new Date(start);
  const { clashes, items, next } = useConflicts([{ start: a, end: new Date(a.getTime() + Math.max(mins, 1) * 60000) }], (i) => i.time_block_id === item.time_block_id);
  async function run(fn: () => Promise<void>) { setErr(null); setBusy(true); try { await fn(); onDone(); onClose(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } }
  return (
    <Modal title="Edit planned time" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); run(() => api.moveTimeBlock(item.commitment_id, item.time_block_id!, a.toISOString(), new Date(a.getTime() + mins * 60000).toISOString())); }} className="space-y-3">
        <p className="text-sm text-muted">{item.title}</p>
        <Field label="Starts"><input type="datetime-local" required className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Length (minutes)"><NumInput min={5} step={5} required value={mins} onChange={setMins} /></Field>
        <ConflictNote clashes={clashes} items={items} allow={allow} setAllow={setAllow} next={next} onUse={(d) => setStart(toLocalInput(d))} />
        <ErrorNote msg={err} />
        <div className="flex justify-between gap-2 pt-1">
          <Button type="button" variant="danger" disabled={busy} onClick={() => run(() => api.deleteTimeBlock(item.commitment_id, item.time_block_id!))}>Remove block</Button>
          <span className="flex gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || (clashes.length > 0 && !allow) || mins < 5}>Save</Button></span>
        </div>
      </form>
    </Modal>
  );
}

/** Change just one day of a repeating event, for example a half day at work. The other days stay as they are. */
export function EditOccurrence({ item, onClose, onDone }: { item: CalendarItem; onClose: () => void; onDone: () => void }) {
  const s0 = new Date(item.start_at), e0 = new Date(item.end_at);
  const [title, setTitle] = useState(item.title);
  const [start, setStart] = useState(toLocalInput(s0));
  const [end, setEnd] = useState(toLocalInput(e0));
  const [allow, setAllow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { clashes, items, next } = useConflicts([{ start: new Date(start), end: new Date(end) }], (i) => i.commitment_id === item.commitment_id && i.occurrence_date === item.occurrence_date);
  const useTime = (d: Date) => { const len = new Date(end).getTime() - new Date(start).getTime(); setStart(toLocalInput(d)); setEnd(toLocalInput(new Date(d.getTime() + len))); };
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await splitOccurrence(item, { start: new Date(start), end: new Date(end), title }); onDone(); onClose(); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal title="Edit just this day" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <p className="text-sm text-muted">Only {s0.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })} changes. The rest of the repeat stays as it is.</p>
        <Field label="Title"><input required className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts"><input type="datetime-local" required className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Ends"><input type="datetime-local" required className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <ConflictNote clashes={clashes} items={items} allow={allow} setAllow={setAllow} next={next} onUse={useTime} />
        <ErrorNote msg={err} />
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || (clashes.length > 0 && !allow)}>Save this day</Button></div>
      </form>
    </Modal>
  );
}
