import { useMemo, useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import { usePlanets } from "../planets";
import { usePrefs } from "../prefs";
import { DAYS, type Day, type NewCommitment } from "../types";
import { Button, ErrorNote, Field, inputCls, Modal, NumInput } from "./ui";
import { ConflictNote, useConflicts, type Slot } from "./Conflicts";
import { addDays, endOfDayISO, localInputToISO, mondayOf, toLocalInput, ymd } from "../lib";

const wkLabel = (m: Date) => `${m.toLocaleDateString([], { day: "numeric", month: "short" })} – ${addDays(m, 6).toLocaleDateString([], { day: "numeric", month: "short" })}`;
const atTime = (d: Date, hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m); };

export function CommitmentForm({ onClose, onDone, initial }: { onClose: () => void; onDone: () => void; initial?: { start: Date; end: Date } }) {
  const { planets: allPlanets } = usePlanets();
  const { on } = usePrefs();
  const planets = on("study") ? allPlanets : allPlanets.filter((p) => p.kind !== "study");
  const jobs = useAsync(() => api.jobs(), []);
  const [mode, setMode] = useState<"flexible" | "fixed">(initial ? "fixed" : "flexible");
  const [title, setTitle] = useState("");
  const [planetId, setPlanetId] = useState(planets[0]?.id ?? "");
  const planet = planets.find((p) => p.id === planetId) ?? planets[0];
  const [estimate, setEstimate] = useState(120);
  const [due, setDue] = useState("");
  const [dueTime, setDueTime] = useState<string | null>(null);   // null = just the day

  const now = new Date(); now.setHours(now.getHours() + 1, 0, 0, 0);
  const [start, setStart] = useState(toLocalInput(initial?.start ?? now));
  const [end, setEnd] = useState(toLocalInput(initial?.end ?? new Date(now.getTime() + 3600000)));

  const [allDay, setAllDay] = useState(false);
  const [timeOff, setTimeOff] = useState(true);
  const [dFrom, setDFrom] = useState(ymd(new Date()));
  const [dTo, setDTo] = useState(ymd(new Date()));
  const [allow, setAllow] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [days, setDays] = useState<Day[]>([]);
  const [t1, setT1] = useState("17:00");
  const [t2, setT2] = useState("18:00");
  const [firstWeek, setFirstWeek] = useState(ymd(new Date()));
  const [lastWeek, setLastWeek] = useState(ymd(addDays(new Date(), 7 * 11)));
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [jobId, setJobId] = useState("");
  const [isExam, setIsExam] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const weeks = useMemo(() => {
    const a = mondayOf(new Date(firstWeek + "T00:00")), b = mondayOf(new Date(lastWeek + "T00:00"));
    const out: Date[] = [];
    for (let d = a; d.getTime() <= b.getTime() && out.length < 60; d = addDays(d, 7)) out.push(d);
    return out;
  }, [firstWeek, lastWeek]);

  const slots: Slot[] = useMemo(() => {
    if (mode !== "fixed" || allDay) return [];
    if (!repeat) return [{ start: new Date(start), end: new Date(end) }];
    if (days.length === 0 || t2 <= t1) return [];
    const out: Slot[] = [], from = new Date(firstWeek + "T00:00");
    weeks.forEach((w, i) => { if (skipped.has(i)) return; DAYS.filter((d) => days.includes(d)).forEach((d) => {
      const day = addDays(w, DAYS.indexOf(d)); if (day >= from && out.length < 120) out.push({ start: atTime(day, t1), end: atTime(day, t2) }); }); });
    return out;
  }, [mode, allDay, repeat, start, end, days, t1, t2, firstWeek, weeks, skipped]);
  const { clashes, items: dayItems, next } = useConflicts(slots);
  const useTime = (d: Date) => { const len = new Date(end).getTime() - new Date(start).getTime(); setStart(toLocalInput(d)); setEnd(toLocalInput(new Date(d.getTime() + len))); };
  const blocked = clashes.length > 0 && !allow;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!planet) return setErr("Create a planet first.");
    setBusy(true);
    try {
      let body: NewCommitment;
      let skipDates: string[] = [];
      if (mode === "flexible") {
        body = { mode, title, planet_id: planet.id, estimated_duration_minutes: estimate,
          due_at: due ? (dueTime ? localInputToISO(`${due}T${dueTime}`) : endOfDayISO(due)) : null, due_all_day: !!due && dueTime === null };
      } else if (allDay) {
        const a = new Date(dFrom + "T00:00"), b = addDays(new Date(dTo + "T00:00"), 1);
        if (b <= a) throw new Error("The last day is before the first day.");
        body = { mode, title, planet_id: planet.id, start_at: a.toISOString(), end_at: b.toISOString(), time_off: timeOff };
      } else if (repeat) {
        if (days.length === 0) throw new Error("Tick at least one day.");
        if (weeks.length === 0) throw new Error("The last week is before the first week.");
        if (t2 <= t1) throw new Error("The end time must be after the start time.");
        const order = DAYS.filter((d) => days.includes(d)), m1 = weeks[0];
        const first = addDays(m1, DAYS.indexOf(order[0]));
        body = { mode, title, planet_id: planet.id, start_at: atTime(first, t1).toISOString(), end_at: atTime(first, t2).toISOString(),
          recurrence_rule: { freq: "weekly", interval: 1, days: order }, recurrence_end_date: ymd(addDays(weeks[weeks.length - 1], 6)) };
        weeks.forEach((w, i) => { if (skipped.has(i)) order.forEach((d) => skipDates.push(ymd(addDays(w, DAYS.indexOf(d))))); });
        skipDates = skipDates.filter((d) => d >= ymd(first));
      } else {
        body = { mode, title, planet_id: planet.id, start_at: localInputToISO(start), end_at: localInputToISO(end) };
      }
      const created = await api.createCommitment(body);
      for (const d of skipDates) { try { await api.cancelOccurrence(created.id, d); } catch { /* not an occurrence date */ } }
      if (mode === "fixed" && planet.kind === "work" && jobId) { try { await api.setShiftJob(created.id, jobId); } catch { /* optional */ } }
      if (on("study") && mode === "fixed" && !repeat && planet.kind === "study" && isExam) await api.setExam(created.id);
      onDone(); onClose();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  const tab = (m: typeof mode, label: string, hint: string) => (
    <button type="button" onClick={() => setMode(m)} className={`flex-1 rounded-lg border px-3 py-2 text-left text-sm ${mode === m ? "border-ink bg-surface2" : "border-line text-muted"}`}>
      <span className="block font-medium">{label}</span><span className="text-xs">{hint}</span>
    </button>
  );

  return (
    <Modal title="New commitment" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex gap-2">
          {tab("flexible", "Flexible", "Work to fit in somewhere")}
          {tab("fixed", "Fixed", "Happens at a set time")}
        </div>
        <Field label="Title"><input required autoFocus className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Planet">
          <select className={inputCls} value={planet?.id ?? ""} onChange={(e) => setPlanetId(e.target.value)}>
            {planets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>

        {mode === "flexible" ? (<>
          <Field label="Estimated effort (minutes)"><NumInput min={0} step={5} required value={estimate} onChange={setEstimate} /></Field>
          <Field label="Due on (optional)">
            <div className="flex gap-2">
              <input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />
              {due && dueTime !== null && <input type="time" className={inputCls + " max-w-32"} value={dueTime} onChange={(e) => setDueTime(e.target.value)} />}
            </div>
          </Field>
          {due && (
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={dueTime !== null} onChange={(e) => setDueTime(e.target.checked ? "09:00" : null)} />
              It has a set time (an exam or hand-in), not just a day
            </label>
          )}
        </>) : (<>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allDay} onChange={(e) => { setAllDay(e.target.checked); if (e.target.checked) setRepeat(false); }} /> All day, or several days (a trip, a holiday, an event)</label>
          {!allDay && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> Repeats on certain days each week</label>}
          {allDay ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="First day"><input type="date" required className={inputCls} value={dFrom} onChange={(e) => { setDFrom(e.target.value); if (dTo < e.target.value) setDTo(e.target.value); }} /></Field>
              <Field label="Last day"><input type="date" required className={inputCls} min={dFrom} value={dTo} onChange={(e) => setDTo(e.target.value)} /></Field>
              <label className="col-span-2 flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={timeOff} onChange={(e) => setTimeOff(e.target.checked)} /> This is time off (highlighted across these days)</label>
            </div>
          ) : !repeat ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts"><input type="datetime-local" required className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
              <Field label="Ends"><input type="datetime-local" required className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg bg-surface2 p-3">
              <div>
                <span className="mb-1 block text-sm font-medium text-muted">Which days</span>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((d) => (
                    <button type="button" key={d} onClick={() => setDays((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]))}
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium ${days.includes(d) ? "border-ink bg-ink text-bg" : "border-line2 bg-surface"}`}>{d[0] + d.slice(1).toLowerCase()}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From"><input type="time" required className={inputCls} value={t1} onChange={(e) => setT1(e.target.value)} /></Field>
                <Field label="To"><input type="time" required className={inputCls} value={t2} onChange={(e) => setT2(e.target.value)} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="First week (pick any day in it)"><input type="date" className={inputCls} value={firstWeek} onChange={(e) => { setFirstWeek(e.target.value); setSkipped(new Set()); }} /></Field>
                <Field label="Last week (any day in it)"><input type="date" className={inputCls} min={firstWeek} value={lastWeek} onChange={(e) => { setLastWeek(e.target.value); setSkipped(new Set()); }} /></Field>
              </div>
              {weeks.length > 0 && (
                <div>
                  <span className="mb-1 block text-sm font-medium text-muted">Tap any week this doesn't happen ({weeks.length - skipped.size} of {weeks.length} weeks active)</span>
                  <div className="flex flex-wrap gap-1.5">
                    {weeks.map((w, i) => (
                      <button type="button" key={i} onClick={() => setSkipped((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                        className={`rounded-md border px-2 py-1 text-[11px] ${skipped.has(i) ? "border-line text-faint line-through" : "border-line2 text-ink"}`}>{wkLabel(w)}</button>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-muted">Same clock time each time, even across daylight-saving changes.</p>
            </div>
          )}
          {on("study") && !repeat && planet?.kind === "study" && (
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={isExam} onChange={(e) => setIsExam(e.target.checked)} />
              This is an exam (Orbit will quietly clear the money noise as it gets close)
            </label>
          )}
          {on("work") && planet?.kind === "work" && (
            <Field label="Which job? (so Orbit can estimate pay)">
              <select className={inputCls} value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">Not linked</option>
                {(jobs.data ?? []).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
              {jobs.data?.length === 0 && <span className="mt-1 block text-xs text-faint">Add a job under Finance → Income to see expected pay.</span>}
            </Field>
          )}
        </>)}
        {mode === "fixed" && <ConflictNote clashes={clashes} items={dayItems} allow={allow} setAllow={setAllow} next={next} onUse={!repeat ? useTime : undefined} />}
        <ErrorNote msg={err} />
        <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || blocked}>{busy ? "Creating…" : "Create"}</Button></div>
      </form>
    </Modal>
  );
}
