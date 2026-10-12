/**
 * In-memory stand-in for the backend, used ONLY when built with VITE_DEMO=true
 * (the shareable preview). It mirrors the real API's contract and the same
 * capacity maths, so the UI can be explored without a server.
 */
import type { Note, Prefs, Api, CalendarItem, Commitment, CommitmentDemand, Job, NewCommitment, Occasion, Planet, RecurrenceRule, Term, TermsInfo, WeekCapacity, StudyPlan } from "./types";
import { finDemoApi, finDemoExtras } from "./finDemo";
import { isAllDay } from "./lib";
import { jobList } from "./demoJobs";

const MIN = 60_000, DAY = 86_400_000;
const CAPACITY = 2400;

const mondayOf = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const at = (day: Date, h: number, m = 0) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

interface TB { id: string; commitment_id: string; start: number; end: number; status: "planned" | "completed"; actual?: number }
let seq = 0;
const nid = () => `demo-${++seq}`;

const thisMonday = mondayOf(new Date());
let planets: Planet[] = [
  { id: "pl-study", name: "Study", kind: "study", color: "study" }, { id: "pl-work", name: "Work", kind: "work", color: "work" },
  { id: "pl-personal", name: "Personal", kind: "personal", color: "personal" }, { id: "pl-other", name: "Other", kind: "other", color: "other" },
  { id: "pl-cello", name: "Cello", kind: "personal", color: "violet" },
];
const planetFor = (cat: string) => planets.find((p) => p.kind === cat)!.id;
let occasionList: { id: string; title: string; occurs_on: string; occurs_time: string | null; repeats_yearly: boolean }[] = [
  { id: "oc-1", title: "Mum's birthday", occurs_on: ymd(new Date(1975, new Date().getMonth(), new Date().getDate() + 5)), occurs_time: null, repeats_yearly: true },
  { id: "oc-2", title: "Family dinner", occurs_on: ymd(new Date(Date.now() + 2 * DAY)), occurs_time: "19:30:00", repeats_yearly: false },
];
let studyPlanList: StudyPlan[] = [];
const D0 = (n: number) => ymd(new Date(thisMonday.getTime() + n * DAY));
let termList: Term[] = [
  { id: "t1", kind: "term", name: "Semester 1", start_date: D0(-35), end_date: D0(13) },
  { id: "t2", kind: "break", name: "Mid-semester break", start_date: D0(14), end_date: D0(27) },
  { id: "t3", kind: "term", name: "Semester 1 (second half)", start_date: D0(28), end_date: D0(84) },
];
function termsInfo(): TermsInfo {
  const t = ymd(new Date()), cur = termList.find((x) => x.start_date <= t && t <= x.end_date) ?? null, next = termList.find((x) => x.start_date > t) ?? null;
  const last = [...termList].sort((a, b) => b.end_date.localeCompare(a.end_date))[0];
  const needs = !termList.length || (cur?.kind === "break" && !termList.some((x) => x.kind === "term" && x.start_date > t));
  const soon = !!last && (new Date(last.end_date).getTime() - Date.now()) / DAY <= 14;
  return { terms: [...termList].sort((a, b) => a.start_date.localeCompare(b.start_date)), current: cur, next, needs_input: needs || soon,
    message: needs ? "You're in a time-off period and your next busy period isn't entered yet." : soon ? `Your last entered period ends on ${last.end_date}. Add what comes next when you know it.` : null };
}
const store: { commitments: Commitment[]; blocks: TB[]; exceptions: Set<string> } = { commitments: [], blocks: [], exceptions: new Set() };

function base(p: Partial<Commitment> & Pick<Commitment, "title" | "mode" | "category">): Commitment {
  return { id: nid(), description: null, status: "todo", priority: 3, start_at: null, end_at: null, due_at: null,
    estimated_duration_minutes: null, recurrence_rule: null, recurrence_end_date: null, recurrence_template_id: null,
    occurrence_date: null, completed_at: null, due_all_day: false, goal_id: null, time_off: false, planet_id: planetFor(p.category), ...p };
}
function recurring(title: string, category: Commitment["category"], days: RecurrenceRule["days"], h1: number, m1: number, h2: number, m2: number) {
  store.commitments.push(base({ title, mode: "fixed", category, start_at: at(thisMonday, h1, m1).toISOString(), end_at: at(thisMonday, h2, m2).toISOString(),
    recurrence_rule: { freq: "weekly", interval: 1, days } }));
}
recurring("Blockchain Innovations lecture", "study", ["MON", "WED"], 9, 0, 11, 0);
recurring("Web dev lab", "study", ["THU"], 14, 0, 17, 0);
recurring("Part-time shift", "work", ["TUE", "SAT"], 10, 0, 16, 0);
recurring("Gym", "personal", ["TUE", "FRI"], 18, 0, 19, 30);

const report = base({ title: "Digital marketing report", mode: "flexible", category: "study", estimated_duration_minutes: 360, due_at: at(new Date(thisMonday.getTime() + 4 * DAY), 23, 59).toISOString() });
const revision = base({ title: "Economics test revision", mode: "flexible", category: "study", estimated_duration_minutes: 240, due_at: at(new Date(thisMonday.getTime() + 2 * DAY), 9, 0).toISOString() });
const portfolio = base({ title: "Orbit portfolio write-up", mode: "flexible", category: "personal", estimated_duration_minutes: 300 });
store.commitments.push(report, revision, portfolio);
store.blocks.push(
  { id: nid(), commitment_id: report.id, start: at(new Date(thisMonday.getTime() + 1 * DAY), 19, 0).getTime(), end: at(new Date(thisMonday.getTime() + 1 * DAY), 21, 0).getTime(), status: "planned" },
  { id: nid(), commitment_id: report.id, start: at(new Date(thisMonday.getTime() + 3 * DAY), 19, 0).getTime(), end: at(new Date(thisMonday.getTime() + 3 * DAY), 21, 0).getTime(), status: "planned" },
);

const byId = (id: string) => store.commitments.find((c) => c.id === id)!;

function expand(t: Commitment, from: number, to: number): { date: string; start: number; end: number }[] {
  const rule = t.recurrence_rule!, endMs = t.recurrence_end_date ? new Date(t.recurrence_end_date + "T23:59").getTime() : Infinity, s = new Date(t.start_at!), dur = new Date(t.end_at!).getTime() - s.getTime();
  const anchor = mondayOf(s), out: { date: string; start: number; end: number }[] = [];
  for (let d = new Date(Math.max(mondayOf(new Date(from)).getTime(), anchor.getTime())); d.getTime() < to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const weeks = Math.round((mondayOf(d).getTime() - anchor.getTime()) / (7 * DAY));
    if (!rule.days.includes(CODES[d.getDay()] as never) || weeks % rule.interval !== 0) continue;
    const start = at(d, s.getHours(), s.getMinutes()).getTime();
    if (start > endMs) continue;
    if (start + dur > from && start < to) out.push({ date: ymd(d), start, end: start + dur });
  }
  return out;
}

function calendar(from: number, to: number): CalendarItem[] {
  const items: CalendarItem[] = [];
  const materialised = new Set(store.commitments.filter((c) => c.recurrence_template_id).map((c) => `${c.recurrence_template_id}|${c.occurrence_date}`));
  for (const c of store.commitments) {
    if (c.mode === "fixed" && !c.recurrence_rule && c.status !== "archived") {
      const s = new Date(c.start_at!).getTime(), e = new Date(c.end_at!).getTime();
      if (s < to && e > from) items.push({ kind: "fixed", commitment_id: c.id, title: c.title, category: c.category, planet_id: c.planet_id, start_at: c.start_at!, end_at: c.end_at!, status: c.status, is_virtual: false, occurrence_date: c.occurrence_date, time_block_id: null });
    } else if (c.recurrence_rule && c.status !== "archived") {
      for (const o of expand(c, from, to)) {
        const key = `${c.id}|${o.date}`;
        if (store.exceptions.has(key) || materialised.has(key)) continue;
        items.push({ kind: "virtual_occurrence", commitment_id: c.id, title: c.title, category: c.category, planet_id: c.planet_id, start_at: new Date(o.start).toISOString(), end_at: new Date(o.end).toISOString(), status: null, is_virtual: true, occurrence_date: o.date, time_block_id: null });
      }
    }
  }
  for (const b of store.blocks) {
    const c = byId(b.commitment_id);
    if (b.start < to && b.end > from) items.push({ kind: "time_block", commitment_id: c.id, title: c.title, category: c.category, planet_id: c.planet_id, start_at: new Date(b.start).toISOString(), end_at: new Date(b.end).toISOString(), status: b.status, is_virtual: false, occurrence_date: null, time_block_id: b.id });
  }
  return items.sort((a, b) => a.start_at.localeCompare(b.start_at));
}

const minutes = (a: number, b: number) => Math.max(0, (b - a) / MIN);

function capacity(): WeekCapacity {
  const ws = mondayOf(new Date()).getTime(), we = ws + 7 * DAY;
  const clip = (s: string, e: string) => minutes(Math.max(new Date(s).getTime(), ws), Math.min(new Date(e).getTime(), we));
  const items = calendar(ws, we);
  const fixed = items.filter((i) => i.kind !== "time_block" && !isAllDay(i.start_at, i.end_at)).reduce((n, i) => n + clip(i.start_at, i.end_at), 0);
  const planned = items.filter((i) => i.kind === "time_block" && i.status === "planned").reduce((n, i) => n + clip(i.start_at, i.end_at), 0);
  const demands: CommitmentDemand[] = store.commitments
    .filter((c) => c.mode === "flexible" && c.due_at && new Date(c.due_at).getTime() <= we)
    .map((c) => demandOf(c));
  return { week_start: new Date(ws).toISOString(), week_end: new Date(we).toISOString(), weekly_capacity_minutes: CAPACITY,
    fixed_occupied_minutes: fixed, planned_allocation_minutes: planned, occupied_minutes: fixed + planned,
    deadline_pressure_minutes: demands.reduce((n, d) => n + d.unfulfilled_deadline_demand_minutes, 0),
    free_capacity_minutes: CAPACITY - fixed - planned, per_commitment_demand: demands };
}

function demandOf(c: Commitment): CommitmentDemand {
  const bs = store.blocks.filter((b) => b.commitment_id === c.id);
  const E = c.estimated_duration_minutes ?? 0;
  const A = bs.filter((b) => b.status === "completed").reduce((n, b) => n + (b.actual ?? 0), 0);
  const planned = bs.filter((b) => b.status === "planned");
  const P = planned.reduce((n, b) => n + minutes(b.start, b.end), 0);
  const due = c.due_at ? new Date(c.due_at).getTime() : Infinity;
  const Pv = planned.reduce((n, b) => n + minutes(b.start, Math.min(b.end, due)), 0);
  const R = c.status === "completed" || c.status === "skipped" ? 0 : Math.max(0, E - A);
  return { commitment_id: c.id, title: c.title, due_at: c.due_at, due_all_day: c.due_all_day, estimated_duration_minutes: E, actual_minutes: A,
    planned_total_minutes: P, remaining_demand_minutes: R, unallocated_demand_minutes: Math.max(0, R - P), unfulfilled_deadline_demand_minutes: Math.max(0, R - Pv) };
}

let prefs: Prefs = { features: { study: true, work: true, finance: true, investing: true, planning: true, import: true, occasions: true, review: true }, onboarded: false };
let noteList: Note[] = [];
const examIds = new Set<string>();
// one upcoming exam so exam focus can be tried from Finance → Rules
const demoExam = base({ title: "Blockchain mid-term exam", mode: "fixed", category: "study", start_at: at(new Date(Date.now() + 9 * DAY), 9, 0).toISOString(), end_at: at(new Date(Date.now() + 9 * DAY), 11, 0).toISOString() });
store.commitments.push(demoExam); examIds.add(demoExam.id);

let authed = false;
const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));

export const demoApi: Api = {
  login: async () => { authed = true; await wait(0); },
  register: async () => { authed = true; await wait(0); },
  logout: () => { authed = false; },
  isAuthed: () => authed,
  capacity: () => wait(capacity()),
  openDemand: () => wait(store.commitments.filter((c) => c.mode === "flexible" && ["todo", "in_progress"].includes(c.status)).map(demandOf).sort((a, b) => (a.due_at ?? "9").localeCompare(b.due_at ?? "9"))),
  calendar: (s, e) => wait(calendar(new Date(s).getTime(), new Date(e).getTime())),
  commitments: () => wait([...store.commitments].reverse()),
  async createCommitment(c: NewCommitment) {
    const pl = planets.find((p) => p.id === c.planet_id)!;
    const row = c.mode === "flexible"
      ? base({ title: c.title, mode: "flexible", category: pl.kind, planet_id: pl.id, estimated_duration_minutes: c.estimated_duration_minutes, due_at: c.due_at ?? null, due_all_day: !!c.due_all_day, description: c.description ?? null, goal_id: c.goal_id ?? null })
      : base({ title: c.title, mode: "fixed", category: pl.kind, planet_id: pl.id, description: c.description ?? null, time_off: !!c.time_off, start_at: c.start_at, end_at: c.end_at, recurrence_rule: c.recurrence_rule ?? null, recurrence_end_date: c.recurrence_end_date ?? null });
    store.commitments.push(row);
    return wait(row);
  },
  async updateCommitment(id, p) {
    const c = byId(id);
    if (p.title !== undefined) { if (!p.title.trim()) throw new Error("A title is needed."); c.title = p.title.trim(); }
    if (p.description !== undefined) c.description = p.description;
    if (p.time_off !== undefined) c.time_off = p.time_off;
    if (p.planet_id) { const pl = planets.find((x) => x.id === p.planet_id); if (pl) { c.planet_id = pl.id; c.category = pl.kind; } }
    if (c.mode === "fixed") {
      const s = p.start_at ?? c.start_at!, e = p.end_at ?? c.end_at!;
      if (new Date(e) <= new Date(s)) throw new Error("The end must be after the start.");
      c.start_at = s; c.end_at = e;
    } else {
      if (p.estimated_duration_minutes !== undefined) c.estimated_duration_minutes = p.estimated_duration_minutes;
      if (p.due_at !== undefined) { c.due_at = p.due_at; if (p.due_at === null) c.due_all_day = false; }
      if (p.due_all_day !== undefined) c.due_all_day = p.due_all_day;
    }
    return wait({ ...c });
  },
  async moveTimeBlock(_c, tb, s, e) { const b = store.blocks.find((x) => x.id === tb)!; if (new Date(e) <= new Date(s)) throw new Error("The end must be after the start."); b.start = new Date(s).getTime(); b.end = new Date(e).getTime(); await wait(0); },
  async deleteTimeBlock(_c, tb) { store.blocks = store.blocks.filter((x) => x.id !== tb); await wait(0); },
  studyPlans: () => wait([...studyPlanList]),
  async createStudyPlan(p) { const row: StudyPlan = { id: nid(), ...p }; studyPlanList.push(row); return wait(row); },
  async deleteStudyPlan(id) {
    studyPlanList = studyPlanList.filter((g) => g.id !== id);
    store.commitments.filter((c) => c.goal_id === id).forEach((c) => { c.status = "archived"; });
    store.blocks = store.blocks.filter((b) => store.commitments.find((c) => c.id === b.commitment_id)?.status !== "archived");
    await wait(0);
  },
  async completeCommitment(id) { const c = byId(id); c.status = "completed"; c.completed_at = new Date().toISOString(); await wait(0); },
  async archiveCommitment(id) { byId(id).status = "archived"; await wait(0); },
  async addTimeBlock(id, s, e) { store.blocks.push({ id: nid(), commitment_id: id, start: new Date(s).getTime(), end: new Date(e).getTime(), status: "planned" }); await wait(0); },
  async completeTimeBlock(_c, tb, actual) { const b = store.blocks.find((x) => x.id === tb)!; b.status = "completed"; b.actual = actual; await wait(0); },
  async cancelOccurrence(id, date) { store.exceptions.add(`${id}|${date}`); await wait(0); },
  ...finDemoApi,
  preferences: () => wait({ ...prefs, features: { ...prefs.features } }),
  async setPreferences(p) { prefs = { features: { ...prefs.features, ...(p.features ?? {}) }, onboarded: p.onboarded ?? prefs.onboarded }; return wait({ ...prefs, features: { ...prefs.features } }); },
  notes: () => wait([...noteList].sort((a, b) => Number(a.done) - Number(b.done) || b.created_at.localeCompare(a.created_at))),
  async addNote(n) { if (!n.text.trim()) throw new Error("Write something first."); const row: Note = { id: nid(), kind: n.kind, text: n.text.trim(), page: n.page, done: false, created_at: new Date().toISOString() }; noteList.push(row); return wait(row); },
  async patchNote(id, p) { const n = noteList.find((x) => x.id === id)!; if (p.done != null) n.done = p.done; if (p.text?.trim()) n.text = p.text.trim(); return wait({ ...n }); },
  async deleteNote(id) { noteList = noteList.filter((x) => x.id !== id); await wait(0); },
  async examFocus() {
    const days = (await finDemoApi.finSettings()).exam_focus_days, now = Date.now();
    const ex = store.commitments.filter((c) => examIds.has(c.id) && c.status === "todo" && c.start_at && new Date(c.end_at!).getTime() >= now && new Date(c.start_at).getTime() <= now + days * DAY)
      .sort((a, b) => a.start_at!.localeCompare(b.start_at!))[0];
    if (days <= 0 || !ex) return wait({ active: false, days, exam: null, study_hours_planned: 0 });
    const st = new Date(ex.start_at!).getTime();
    const mins = store.blocks.filter((b) => b.status === "planned" && b.start >= now && b.start < st && store.commitments.find((c) => c.id === b.commitment_id)?.category === "study").reduce((n, b) => n + (b.end - b.start) / MIN, 0);
    return wait({ active: true, days, exam: { id: ex.id, title: ex.title, start_at: ex.start_at!, days_away: Math.max(0, Math.round((new Date(ymd(new Date(st))).getTime() - new Date(ymd(new Date())).getTime()) / DAY)) }, study_hours_planned: +(mins / 60).toFixed(1) });
  },
  setExam: async (cid) => { const c = byId(cid); if (c.mode !== "fixed" || c.category !== "study") throw new Error("An exam needs to be a fixed commitment on a study planet."); examIds.add(cid); await wait(0); },
  async review(week) {
    const b = finDemoExtras.reviewBase(week), lo = new Date(b.week_start + "T00:00").getTime(), hi = lo + 7 * DAY;
    const blocks = store.blocks.filter((x) => x.status === "completed" && x.start >= lo && x.start < hi);
    const kinds: Record<string, number> = {};
    for (const x of blocks) { const k = store.commitments.find((c) => c.id === x.commitment_id)?.category ?? "other"; kinds[k] = (kinds[k] ?? 0) + (x.actual ?? (x.end - x.start) / MIN) / 60; }
    const done = store.commitments.filter((c) => c.status === "completed" && c.completed_at && !c.recurrence_rule && new Date(c.completed_at).getTime() >= lo && new Date(c.completed_at).getTime() < hi);
    return wait({ ...b, study_hours: +(kinds.study ?? 0).toFixed(1), focused_hours_by_kind: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, +v.toFixed(1)])), done: done.slice(0, 10).map((c) => ({ title: c.title, category: c.category })), done_count: done.length });
  },
  async exportData() { throw new Error("Downloads are switched off in this preview. In the real app this saves a file to your device."); },
  planets: () => wait([...planets]),
  async addPlanet(name, kind, color) { const p: Planet = { id: nid(), name, kind, color }; planets.push(p); return wait(p); },
  async renamePlanet(pid, name, color) { const p = planets.find((x) => x.id === pid)!; p.name = name; if (color) p.color = color; await wait(0); },
  async deletePlanet(pid) {
    if (store.commitments.some((c) => c.planet_id === pid && ["todo", "in_progress"].includes(c.status))) throw new Error("Something active still lives on this planet. Finish, archive or move those commitments first.");
    planets = planets.filter((p) => p.id !== pid); await wait(0);
  },
  terms: () => wait(termsInfo()),
  async addTerm(t) { const row = { id: nid(), ...t }; termList.push(row); return wait(row); },
  async deleteTerm(tid) { termList = termList.filter((t) => t.id !== tid); await wait(0); },
  jobs: () => wait(jobList.map((j) => ({ ...j }))),
  async addJob(j) { const row: Job = { id: nid(), ...j, is_main: jobList.length === 0 }; jobList.push(row); return wait(row); },
  async deleteJob(jid) { const i = jobList.findIndex((j) => j.id === jid); if (i >= 0) jobList.splice(i, 1); await wait(0); },
  async setMainJob(jid) { jobList.forEach((j) => { j.is_main = j.id === jid; }); await wait(0); },
  setShiftJob: async () => { await wait(0); },
  shiftJob: async () => null,
  occasions: async (start, end) => {
    const s0 = start ?? ymd(new Date()), e0 = end ?? ymd(new Date(Date.now() + 60 * DAY)), t0 = new Date(ymd(new Date()) + "T00:00").getTime(), out: Occasion[] = [];
    for (const o of occasionList) {
      const years = o.repeats_yearly ? [new Date(s0).getFullYear(), new Date(e0).getFullYear()] : [Number(o.occurs_on.slice(0, 4))];
      for (const y of new Set(years)) {
        const d = o.repeats_yearly ? `${y}${o.occurs_on.slice(4)}` : o.occurs_on;
        if (d >= s0 && d <= e0 && d >= o.occurs_on) out.push({ id: o.id, title: o.title, date: d, time: o.occurs_time, repeats_yearly: o.repeats_yearly, note: null, years: o.repeats_yearly ? y - Number(o.occurs_on.slice(0, 4)) : null, days_away: Math.round((new Date(d + "T00:00").getTime() - t0) / DAY) });
      }
    }
    return wait(out.sort((a, b) => a.date.localeCompare(b.date)));
  },
  addOccasion: async (o) => { occasionList.push({ id: nid(), title: o.title, occurs_on: o.occurs_on, occurs_time: o.occurs_time ?? null, repeats_yearly: o.repeats_yearly }); await wait(0); },
  deleteOccasion: async (oid) => { occasionList = occasionList.filter((x) => x.id !== oid); await wait(0); },
  async attendOccurrence(id, date) {
    const t = byId(id), o = expand(t, new Date(date + "T00:00").getTime(), new Date(date + "T00:00").getTime() + DAY)[0];
    store.commitments.push(base({ title: t.title, mode: "fixed", category: t.category, planet_id: t.planet_id, start_at: new Date(o.start).toISOString(), end_at: new Date(o.end).toISOString(),
      recurrence_template_id: id, occurrence_date: date, status: "completed", completed_at: new Date().toISOString() }));
    await wait(0);
  },
};
