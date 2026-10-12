import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { usePlanets } from "../planets";
import { Button, ErrorNote, Field, inputCls, Modal, NumInput } from "./ui";
import { addDays, dayLabel, endOfDayISO, hours, isAllDay, startOfDay, timeLabel, ymd } from "../lib";
import { useRest } from "../settings";
import { readFile, type Doc } from "../study/pdf";
import { assignmentPieces, defaultHours, describe, lectureSessions, parseBrief, schedule, splitLectures, type Busy, type Piece, type Placement } from "../study/breakdown";

type Kind = "assignment" | "exam";

/** Upload a brief or lectures, review what Orbit proposes, then create the plan. Nothing is made until you confirm. */
export function StudyBuilder({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { planets } = usePlanets();
  const [rest] = useRest();
  const [kind, setKind] = useState<Kind>("assignment");
  const [step, setStep] = useState<"input" | "review">("input");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [reading, setReading] = useState(false);
  const [pasted, setPasted] = useState("");
  const [title, setTitle] = useState("");
  const [planetId, setPlanetId] = useState(planets.find((p) => p.kind === "study")?.id ?? planets[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [chunk, setChunk] = useState(60);
  const [perDay, setPerDay] = useState(240);
  const [totalH, setTotalH] = useState(10);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [revise, setRevise] = useState(true);
  const [busy, setBusy] = useState<Busy[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const today = startOfDay(new Date());
  const dateOk = !!date && new Date(date + "T00:00:00").getTime() >= today.getTime();

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setReading(true); setErr(null);
    try {
      const out: Doc[] = [];
      for (const f of Array.from(list).slice(0, kind === "exam" ? 30 : 1)) out.push(await readFile(f));
      setDocs(out);
      if (out.every((d) => d.pages.join("").trim().length < 40)) setErr("That file has hardly any readable text (a scan or image, perhaps). You can still build the plan by hand in the next step.");
      if (kind === "assignment") {
        const b = parseBrief(out[0]);
        setTitle((t) => t || b.title);
        if (b.due) setDate(ymd(b.due));
        setTotalH(defaultHours(b.weightPct));
        setHint([b.due ? `Due date found: ${dayLabel(b.due)}` : "No clear due date in the brief, so please set it", b.weightPct ? `${b.weightPct}% of the grade` : null, b.deliverables.length ? `${b.deliverables.length} deliverables spotted` : "no separate deliverables spotted, so the usual stages will be used"].filter(Boolean).join(" · "));
      } else setHint(`${splitLectures(out).length} lectures found`);
    } catch (e) { setErr(`Couldn't read that file: ${(e as Error).message}`); }
    finally { setReading(false); }
  }

  function readPasted() {
    if (!pasted.trim()) return;
    void import("../study/pdf").then(({ fromText }) => {
      const d = fromText("Pasted brief", pasted); setDocs([d]);
      const b = parseBrief(d);
      setTitle((t) => t || b.title); if (b.due) setDate(ymd(b.due)); setTotalH(defaultHours(b.weightPct));
      setHint(`${b.due ? `Due date found: ${dayLabel(b.due)}` : "No clear due date found"} · ${b.deliverables.length} deliverables spotted`);
    });
  }

  function propose() {
    setErr(null);
    if (!dateOk) { setErr(kind === "exam" ? "Pick the exam date (today or later)." : "Pick the due date (today or later)."); return; }
    if (kind === "assignment") {
      const b = docs[0] ? parseBrief(docs[0]) : { title, due: null, weightPct: null, deliverables: [] };
      setPieces(assignmentPieces(b, Math.round(totalH * 60)));
    } else {
      if (!docs.length) { setErr("Add the lecture files first."); return; }
      setPieces(splitLectures(docs).flatMap((l) => lectureSessions(l, chunk)));
    }
    setStep("review");
  }

  const due = date ? new Date(date + "T00:00:00") : null;
  const first = today;
  const last = due ? (kind === "exam" ? addDays(due, -1) : addDays(due, -1)) : today;
  useEffect(() => {
    if (step !== "review" || !due) return;
    let live = true;
    api.calendar(today.toISOString(), addDays(due, 1).toISOString()).then((items) => {
      if (live) setBusy(items.filter((i) => !(i.status && ["skipped", "cancelled", "completed"].includes(i.status)) && !isAllDay(i.start_at, i.end_at)).map((i) => ({ start: new Date(i.start_at).getTime(), end: new Date(i.end_at).getTime() })));
    }).catch(() => live && setBusy([]));
    return () => { live = false; };
  }, [step, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = useMemo(() => {
    if (busy === null || !due) return null;
    const main = kind === "exam" && revise ? pieces.filter((p) => !p.id.startsWith("rev")) : pieces;
    const lastMain = kind === "exam" && revise ? new Date(Math.max(first.getTime(), addDays(due, -3).getTime())) : last;
    const a = schedule(main, { first, last: lastMain, chunkMin: chunk, maxPerDay: perDay, busy, now: Date.now(), dayStartH: rest.before, dayEndH: rest.after });
    let placements = a.placements, unplaced = a.unplaced;
    if (kind === "exam" && revise) {
      const rev = pieces.filter((p) => p.id.startsWith("rev"));
      const b2 = schedule(rev, { first: addDays(lastMain, 1) > last ? last : addDays(lastMain, 1), last: last.getTime() < first.getTime() ? first : last, chunkMin: chunk, maxPerDay: perDay, busy: [...busy, ...a.placements.map((x) => ({ start: x.start, end: x.end }))], now: Date.now(), dayStartH: rest.before, dayEndH: rest.after });
      placements = [...placements, ...b2.placements]; unplaced = [...unplaced, ...b2.unplaced];
    }
    return { placements: placements.sort((x, y) => x.start - y.start), unplaced };
  }, [pieces, busy, chunk, perDay, date, revise, kind, rest]); // eslint-disable-line react-hooks/exhaustive-deps

  // Revision pieces for an exam are added once the lectures are proposed.
  useEffect(() => {
    if (step !== "review" || kind !== "exam") return;
    setPieces((ps) => {
      const hasRev = ps.some((p) => p.id.startsWith("rev"));
      if (revise && !hasRev) { const n = ps.filter((p) => !p.id.startsWith("rev")); const total = n.reduce((a, p) => a + p.minutes, 0); return [...ps, { id: "rev1", title: "Revision · all lectures", minutes: Math.max(60, Math.round(total * 0.12 / 5) * 5), notes: "Go back over your notes. Redo what felt shaky." }, { id: "rev2", title: "Revision · past papers & weak spots", minutes: Math.max(60, Math.round(total * 0.12 / 5) * 5), notes: "" }]; }
      if (!revise && hasRev) return ps.filter((p) => !p.id.startsWith("rev"));
      return ps;
    });
  }, [step, revise, kind]);

  const byPiece = (id: string) => plan?.placements.filter((p) => p.pieceId === id) ?? [];
  const totalMin = pieces.reduce((a, p) => a + p.minutes, 0);
  const patch = (id: string, x: Partial<Piece>) => setPieces((ps) => ps.map((p) => (p.id === id ? { ...p, ...x } : p)));

  async function create() {
    if (!plan || !due) return;
    setErr(null);
    try {
      setSaving("Creating plan…");
      const g = await api.createStudyPlan({ title: title.trim() || "Untitled plan", target_date: date, kind, source_name: docs.map((d) => d.name).join(", ").slice(0, 200) || null });
      let n = 0;
      for (const p of pieces) {
        const pl: Placement[] = byPiece(p.id);
        const dueDay = pl.length ? startOfDay(new Date(pl[pl.length - 1].end)) : last;
        setSaving(`Adding ${++n} of ${pieces.length}…`);
        const c = await api.createCommitment({ mode: "flexible", title: p.title, planet_id: planetId, estimated_duration_minutes: p.minutes, due_at: endOfDayISO(ymd(dueDay)), due_all_day: false, description: describe(p) || null, goal_id: g.id });
        for (const x of pl) await api.addTimeBlock(c.id, new Date(x.start).toISOString(), new Date(x.end).toISOString());
      }
      onDone(); onClose();
    } catch (e) { setErr((e as Error).message); setSaving(null); }
  }

  if (step === "input") return (
    <Modal wide title="New study plan" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex gap-1 rounded-lg bg-surface2 p-1 text-sm">
          {([["assignment", "Assignment or project"], ["exam", "Exam"]] as [Kind, string][]).map(([k, l]) => (
            <button key={k} onClick={() => { setKind(k); setDocs([]); setHint(null); }} className={`flex-1 rounded-md px-3 py-1.5 ${kind === k ? "bg-surface font-medium text-ink shadow" : "text-muted"}`}>{l}</button>))}
        </div>
        <Field label={kind === "assignment" ? "Upload the brief (PDF or text)" : "Upload your lectures (one file per lecture, or one file for all)"}>
          <input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" multiple={kind === "exam"} onChange={(e) => void onFiles(e.target.files)} className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface2 file:px-3 file:py-2 file:text-ink" />
        </Field>
        <p className="text-xs text-faint">Files are read on your device. Orbit looks at the text to find dates, sections and lecture lengths. It doesn't send anything anywhere.</p>
        {kind === "assignment" && !docs.length && (
          <details className="text-sm"><summary className="cursor-pointer text-muted">…or paste the brief instead</summary>
            <textarea className={`${inputCls} mt-2 h-28`} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the assignment text here" />
            <Button type="button" variant="ghost" className="mt-1" onClick={readPasted}>Read it</Button>
          </details>)}
        {reading && <p className="text-sm text-muted">Reading…</p>}
        {docs.length > 0 && <p className="text-sm text-muted">Read {docs.length} file{docs.length > 1 ? "s" : ""}, {docs.reduce((a, d) => a + d.pages.length, 0)} pages. {hint}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={kind === "assignment" ? "Name" : "Exam name"}><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "assignment" ? "e.g. Marketing report" : "e.g. Finance midterm"} /></Field>
          <Field label="Planet"><select className={inputCls} value={planetId} onChange={(e) => setPlanetId(e.target.value)}>{planets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label={kind === "assignment" ? "Due date" : "Exam date"}><input type="date" className={inputCls} min={ymd(today)} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          {kind === "assignment" && <Field label="Total effort (hours)"><NumInput min={1} step={0.5} value={totalH} onChange={setTotalH} /></Field>}
          <Field label="Session length"><select className={inputCls} value={chunk} onChange={(e) => setChunk(+e.target.value)}>{[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}</select></Field>
          <Field label="At most per day"><select className={inputCls} value={perDay} onChange={(e) => setPerDay(+e.target.value)}>{[60, 120, 180, 240, 360].map((m) => <option key={m} value={m}>{hours(m)}</option>)}</select></Field>
        </div>
        {kind === "exam" && <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={revise} onChange={(e) => setRevise(e.target.checked)} /> Keep the last few days before the exam for revision</label>}
        <ErrorNote msg={err} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={reading || !title.trim() || (kind === "exam" && !docs.length)} onClick={propose}>See the plan</Button></div>
      </div>
    </Modal>
  );

  return (
    <Modal wide title={title || "Study plan"} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted">{kind === "exam" ? "Exam" : "Due"} {due && dayLabel(due)} · {hours(totalMin)} in {pieces.length} pieces, spread from today so nothing piles up at the end. Change anything you like before it's added.</p>
        {plan === null && <p className="text-sm text-muted">Looking at your calendar…</p>}
        <ul className="divide-y divide-line rounded-xl border border-line">
          {pieces.map((p) => {
            const pl = byPiece(p.id);
            return (
              <li key={p.id} className="space-y-1 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <input className={`${inputCls} flex-1`} value={p.title} onChange={(e) => patch(p.id, { title: e.target.value })} aria-label="Piece name" />
                  <div className="w-20 shrink-0"><NumInput min={5} step={5} value={p.minutes} onChange={(n) => patch(p.id, { minutes: n })} /></div><span className="text-xs text-faint">min</span>
                  <button className="px-1 text-faint hover:text-neg" onClick={() => setPieces((ps) => ps.filter((x) => x.id !== p.id))} aria-label="Remove">✕</button>
                </div>
                {p.continueFrom && <p className="text-xs text-muted">Continue from {p.continueFrom}</p>}
                <p className="text-xs text-faint">{pl.length ? pl.map((x) => `${dayLabel(new Date(x.start))} ${timeLabel(new Date(x.start).toISOString())}`).join(" · ") : plan ? "No room found" : ""}</p>
              </li>);
          })}
        </ul>
        {plan && plan.unplaced.length > 0 && <p className="rounded-lg bg-surface2 px-3 py-2 text-sm text-muted">{plan.unplaced.length} session{plan.unplaced.length > 1 ? "s" : ""} didn't fit before the deadline. Try longer sessions, a higher daily limit, or fewer pieces. They'll still be added without a time.</p>}
        <ErrorNote msg={err} />
        <div className="flex justify-between gap-2">
          <Button variant="ghost" disabled={!!saving} onClick={() => setStep("input")}>Back</Button>
          <Button disabled={!plan || !!saving || pieces.length === 0} onClick={() => void create()}>{saving ?? "Add to my Orbit"}</Button>
        </div>
      </div>
    </Modal>
  );
}
