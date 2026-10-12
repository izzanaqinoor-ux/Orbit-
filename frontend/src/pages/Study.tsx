import { useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import { Button, Card, ErrorNote, Field, inputCls, Modal, NumInput } from "../components/ui";
import { StudyBuilder } from "../components/StudyBuilder";
import { EditCommitment } from "../components/EditForm";
import { ConflictNote, useConflicts } from "../components/Conflicts";
import { continueLine } from "../study/breakdown";
import { addDays, dayLabel, hours, localInputToISO, timeLabel, toLocalInput } from "../lib";
import { usePlanets } from "../planets";
import type { Commitment } from "../types";

const setContinue = (desc: string | null, where: string) => {
  const rest = (desc ?? "").split("\n").filter((l) => !l.startsWith("Continue from:")).join("\n");
  return [`Continue from: ${where}`, rest].filter(Boolean).join("\n");
};

/** "I stopped here": remember where, and book the next session. */
function Pause({ c, onClose, onDone }: { c: Commitment; onClose: () => void; onDone: () => void }) {
  const next = addDays(new Date(), 1); next.setHours(new Date().getHours() >= 21 ? 10 : Math.max(9, new Date().getHours()), 0, 0, 0);
  const [where, setWhere] = useState("");
  const [start, setStart] = useState(toLocalInput(next));
  const [mins, setMins] = useState(45);
  const [allow, setAllow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const s0 = new Date(start);
  const { clashes, items, next: gap } = useConflicts([{ start: s0, end: new Date(s0.getTime() + Math.max(mins, 1) * 60000) }]);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      await api.updateCommitment(c.id, { description: setContinue(c.description, where.trim()) });
      const s = new Date(localInputToISO(start));
      await api.addTimeBlock(c.id, s.toISOString(), new Date(s.getTime() + mins * 60000).toISOString());
      onDone(); onClose();
    } catch (x) { setErr((x as Error).message); }
  }
  return (
    <Modal title="Pick this up again" onClose={onClose}>
      <form onSubmit={go} className="space-y-3">
        <p className="text-sm text-muted">{c.title}</p>
        <Field label="Where did you stop?"><input required autoFocus className={inputCls} value={where} onChange={(e) => setWhere(e.target.value)} placeholder="e.g. slide 23, the bit on hedging" /></Field>
        <Field label="Next session"><input type="datetime-local" required className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Length (minutes)"><NumInput min={5} step={5} required value={mins} onChange={setMins} /></Field>
        <ConflictNote clashes={clashes} items={items} allow={allow} setAllow={setAllow} next={gap} onUse={(d) => setStart(toLocalInput(d))} />
        <ErrorNote msg={err} />
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={clashes.length > 0 && !allow}>Save & book</Button></div>
      </form>
    </Modal>
  );
}

export default function Study({ rev, bump }: { rev: number; bump: () => void }) {
  const plans = useAsync(() => api.studyPlans(), [rev]);
  const list = useAsync(() => api.commitments(), [rev]);
  const cal = useAsync(() => api.calendar(new Date().toISOString(), addDays(new Date(), 200).toISOString()), [rev]);
  const { style } = usePlanets();
  const [building, setBuilding] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [pause, setPause] = useState<Commitment | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(fn: () => Promise<void>) { setErr(null); try { await fn(); bump(); } catch (e) { setErr((e as Error).message); } }
  const nextOf = (id: string) => (cal.data ?? []).filter((i) => i.commitment_id === id && i.kind === "time_block" && new Date(i.end_at).getTime() > Date.now()).sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
  const rows = (plans.data ?? []).slice().sort((a, b) => (a.target_date ?? "9").localeCompare(b.target_date ?? "9"));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Study</h1>
        <Button onClick={() => setBuilding(true)}>+ New plan</Button>
      </div>
      <ErrorNote msg={err ?? plans.error ?? list.error} />
      {rows.length === 0 && (
        <Card>
          <p className="font-medium">Break a big piece of work into sessions</p>
          <p className="mt-1 text-sm text-muted">Upload an assignment brief, or your lectures for an exam. Orbit reads them on your device, proposes pieces and spreads them across the days you have, so the work doesn't pile up at the end. You can change everything before it's added.</p>
          <Button className="mt-3" onClick={() => setBuilding(true)}>Start a plan</Button>
        </Card>)}
      {rows.map((p) => {
        const pieces = (list.data ?? []).filter((c) => c.goal_id === p.id && c.status !== "archived")
          .sort((a, b) => Number(a.status === "completed") - Number(b.status === "completed") || (nextOf(a.id)?.start_at ?? "9").localeCompare(nextOf(b.id)?.start_at ?? "9"));
        const done = pieces.filter((c) => c.status === "completed").length;
        const daysLeft = p.target_date ? Math.ceil((new Date(p.target_date + "T00:00:00").getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000) : null;
        const mins = pieces.reduce((a, c) => a + (c.estimated_duration_minutes ?? 0), 0);
        return (
          <Card key={p.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">{p.title}</h2>
                <p className="text-xs text-muted">{p.kind === "exam" ? "Exam" : "Due"} {p.target_date ? dayLabel(new Date(p.target_date + "T00:00:00")) : "—"}{daysLeft != null && daysLeft >= 0 ? ` · ${daysLeft === 0 ? "today" : `${daysLeft} day${daysLeft > 1 ? "s" : ""} to go`}` : ""} · {done} of {pieces.length} done · {hours(mins)}</p>
              </div>
              {sure === p.id
                ? <span className="flex gap-1"><Button variant="danger" onClick={() => act(async () => { await api.deleteStudyPlan(p.id); setSure(null); })}>Remove plan and its sessions</Button><Button variant="ghost" onClick={() => setSure(null)}>Keep</Button></span>
                : <Button variant="ghost" onClick={() => setSure(p.id)}>Remove</Button>}
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded bg-surface2"><div className="h-full bg-ink/60" style={{ width: `${pieces.length ? (done / pieces.length) * 100 : 0}%` }} /></div>
            <ul className="mt-2 divide-y divide-line">
              {pieces.map((c) => {
                const n = nextOf(c.id), cont = continueLine(c.description), finished = c.status === "completed";
                return (
                  <li key={c.id} className="py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style(c.planet_id, c.category).dot}`} />
                        <div className="min-w-0">
                          <p className={`truncate text-sm font-medium ${finished ? "text-faint line-through" : ""}`}>{c.title}</p>
                          <p className="text-xs text-muted">{hours(c.estimated_duration_minutes ?? 0)}{n && !finished ? ` · next ${dayLabel(new Date(n.start_at))}, ${timeLabel(n.start_at)}` : ""}{!n && !finished ? " · not scheduled" : ""}</p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {c.description && <Button variant="ghost" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "Hide" : "Notes"}</Button>}
                        <Button variant="ghost" onClick={() => setEdit(c.id)}>Edit</Button>
                        {!finished && <Button variant="ghost" onClick={() => setPause(c)}>Stopped here</Button>}
                        {!finished && <Button variant="ghost" onClick={() => act(() => api.completeCommitment(c.id))}>Done</Button>}
                      </div>
                    </div>
                    {cont && !finished && <p className="ml-5 mt-1 text-xs text-muted">Continue from {cont}</p>}
                    {open === c.id && <pre style={{ fontFamily: "inherit" }} className="ml-5 mt-2 whitespace-pre-wrap rounded-lg bg-surface2 p-3 text-xs leading-relaxed text-muted">{c.description}</pre>}
                  </li>);
              })}
            </ul>
          </Card>);
      })}
      {building && <StudyBuilder onClose={() => setBuilding(false)} onDone={bump} />}
      {edit && <EditCommitment id={edit} onClose={() => setEdit(null)} onDone={bump} />}
      {pause && <Pause c={pause} onClose={() => setPause(null)} onDone={bump} />}
    </div>
  );
}
