import type { Api, CalendarItem, Commitment, CommitmentDemand, Entry, FinCat, FinSettings, HoldingPos, Job, MilestoneRow, NewCommitment, Planet, Pocket, RuleSet, Scenario, Dashboard, NetworthHistory, PlanResult, IncomeSource, Term, TermsInfo, WeekCapacity, WishItem, Occasion, WeekSummary, Statement, Valuations, ExamFocus, Note, Prefs, Review, ImportPreview, ImportResult, ImportSummaryRow, StudyPlan } from "./types";
import { demoApi } from "./demo";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://127.0.0.1:8000";
const TOKEN_KEY = "orbit.token";

const store = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string | null) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = store.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(BASE + path, { ...init, headers });
  if (res.status === 401) { store.set(null); window.dispatchEvent(new Event("orbit:logout")); }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = typeof body.detail === "string" ? body.detail : body.detail?.[0]?.msg ?? msg;
    } catch { /* non-JSON error */ }
    throw new ApiError(res.status, msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const put = <T,>(p: string, body?: unknown) => request<T>(p, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) });
const del = (p: string) => request<void>(p, { method: "DELETE" });
const post = <T,>(p: string, body?: unknown) => request<T>(p, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T,>(p: string, body?: unknown) => request<T>(p, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) });

async function login(email: string, password: string) {
  const res = await fetch(BASE + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: email, password }),
  });
  if (!res.ok) throw new ApiError(res.status, res.status === 401 ? "Wrong email or password" : "Could not sign in");
  store.set((await res.json()).access_token);
}

const realApi: Api = {
  login,
  async register(email, password) {
    await post("/auth/register", { email, password, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    await login(email, password);
  },
  logout: () => store.set(null),
  isAuthed: () => store.get() !== null,
  capacity: () => request<WeekCapacity>("/capacity/current"),
  openDemand: () => request<CommitmentDemand[]>("/demand/open"),
  calendar: (s, e) => request<CalendarItem[]>(`/calendar?start=${encodeURIComponent(s)}&end=${encodeURIComponent(e)}`),
  commitments: () => request<Commitment[]>("/commitments"),
  createCommitment: (c: NewCommitment) => post<Commitment>("/commitments", c),
  completeCommitment: (id) => patch(`/commitments/${id}/complete`),
  updateCommitment: (id, p) => patch<Commitment>(`/commitments/${id}`, p),
  moveTimeBlock: async (id, tb, start_at, end_at) => { await patch(`/commitments/${id}/time_blocks/${tb}`, { start_at, end_at }); },
  deleteTimeBlock: (id, tb) => del(`/commitments/${id}/time_blocks/${tb}`),
  studyPlans: () => request<StudyPlan[]>("/goals").then((gs) => gs.filter((g) => g.kind)),
  createStudyPlan: (p) => post<StudyPlan>("/goals", p),
  deleteStudyPlan: (id) => del(`/goals/${id}`),
  archiveCommitment: (id) => patch(`/commitments/${id}/archive`),
  addTimeBlock: (id, start_at, end_at) => post(`/commitments/${id}/time_blocks`, { start_at, end_at }),
  completeTimeBlock: (id, tb, actual_duration_minutes) => patch(`/commitments/${id}/time_blocks/${tb}/complete`, { actual_duration_minutes }),
  cancelOccurrence: (id, date) => post(`/commitments/${id}/exceptions`, { excluded_date: date }),
  async attendOccurrence(id, date) {
    const row = await post<Commitment>(`/commitments/${id}/occurrences/${date}`);
    await patch(`/commitments/${row.id}/complete`);
  },

  // ── planets, terms, jobs ──
  planets: () => request<Planet[]>("/planets"),
  addPlanet: (name, kind, color) => post<Planet>("/planets", { name, kind, color }),
  renamePlanet: async (id, name, color) => { await patch(`/planets/${id}`, { name, color }); },
  deletePlanet: (id) => del(`/planets/${id}`),
  terms: () => request<TermsInfo>("/terms"),
  addTerm: (t) => post<Term>("/terms", t),
  deleteTerm: (id) => del(`/terms/${id}`),
  jobs: () => request<Job[]>("/jobs"),
  addJob: (j) => post<Job>("/jobs", j),
  deleteJob: (id) => del(`/jobs/${id}`),
  setMainJob: async (id) => { await patch(`/jobs/${id}/main`); },
  shiftJob: async (id) => { try { return (await request<{ job_id: string | null }>(`/commitments/${id}/shift`)).job_id; } catch { return null; } },
  setShiftJob: async (id, job_id) => { await post(`/commitments/${id}/shift`, { job_id }); },
  occasions: (start, end) => request<Occasion[]>("/occasions" + (start || end ? `?${new URLSearchParams({ ...(start ? { start } : {}), ...(end ? { end } : {}) })}` : "")),
  addOccasion: async (o) => { await post("/occasions", o); },
  deleteOccasion: (id) => del(`/occasions/${id}`),

  // ── finance ──
  dashboard: (m) => request<Dashboard>(`/fin/dashboard${m ? `?month=${m}` : ""}`),
  networth: () => request<NetworthHistory>("/fin/networth"),
  plan: (r) => post<PlanResult>("/fin/plan", r),
  pockets: () => request<Pocket[]>("/fin/pockets"),
  addPocket: async (p) => { await post("/fin/pockets", p); },
  patchPocket: async (id, p) => { await patch(`/fin/pockets/${id}`, p); },
  categories: () => request<FinCat[]>("/fin/categories"),
  addCategory: async (c) => { await post("/fin/categories", c); },
  patchCategory: async (id, c) => { await patch(`/fin/categories/${id}`, c); },
  holdings: () => request<HoldingPos[]>("/fin/holdings"),
  addHolding: async (h) => { await post("/fin/holdings", h); },
  patchHolding: async (id, h) => { await patch(`/fin/holdings/${id}`, h); },
  entries: (m) => request<Entry[]>(`/fin/entries${m ? `?month=${m}` : ""}`),
  addEntry: (e) => post<Entry>("/fin/entries", e),
  updateEntry: (id, e) => put<Entry>(`/fin/entries/${id}`, e),
  deleteEntry: (id) => del(`/fin/entries/${id}`),
  wishlist: () => request<WishItem[]>("/fin/wishlist"),
  addWish: async (w) => { await post("/fin/wishlist", w); },
  removeWish: (id) => del(`/fin/wishlist/${id}`),
  addFinGoal: async (g) => { await post("/fin/goals", g); },
  patchFinGoal: async (id, g) => { await patch(`/fin/goals/${id}`, g); },
  rules: () => request<RuleSet[]>("/fin/rules"),
  saveRules: (config) => put<RuleSet>("/fin/rules/current", { config }),
  milestones: () => request<MilestoneRow[]>("/fin/milestones"),
  putMilestone: async (m) => { await put(`/fin/milestones/${m.age}`, m); },
  deleteMilestone: (age) => del(`/fin/milestones/${age}`),
  scenarios: () => request<Scenario[]>("/fin/scenarios"),
  addScenario: (s) => post<Scenario>("/fin/scenarios", s),
  deleteScenario: (id) => del(`/fin/scenarios/${id}`),
  incomeSources: () => request<IncomeSource[]>("/fin/income-sources"),
  saveIncomeSource: async (s) => { if (s.id) await put(`/fin/income-sources/${s.id}`, s); else await post("/fin/income-sources", s); },
  deleteIncomeSource: (id) => del(`/fin/income-sources/${id}`),
  weekSummary: (start) => request<WeekSummary>("/fin/week" + (start ? `?start=${start}` : "")),
  statement: (month) => request<Statement>("/fin/statement" + (month ? `?month=${month}` : "")),
  settleStatement: (month, items) => post<Statement>(`/fin/statement/${month}/settle`, { items }),
  undoSettle: (month, pid) => request<Statement>(`/fin/statement/${month}/pockets/${pid}`, { method: "DELETE" }),
  valuations: () => request<Valuations>("/fin/valuations"),
  recordValuations: (values, month) => put<Valuations>("/fin/valuations", { values, month }),
  importPreview: (rows) => post<ImportPreview>("/fin/import/preview", { rows }),
  importCommit: (rows) => post<ImportResult>("/fin/import/commit", { rows }),
  importSummary: () => request<ImportSummaryRow[]>("/fin/import/summary"),
  review: (week) => request<Review>("/review" + (week ? `?week=${week}` : "")),
  preferences: () => request<Prefs>("/preferences"),
  setPreferences: (p) => put<Prefs>("/preferences", p),
  notes: () => request<Note[]>("/notes"),
  addNote: (n) => post<Note>("/notes", n),
  patchNote: (id, p) => patch<Note>(`/notes/${id}`, p),
  deleteNote: (id) => del(`/notes/${id}`),
  examFocus: () => request<ExamFocus>("/exam-focus"),
  setExam: async (id) => { await post(`/commitments/${id}/exam`, {}); },
  async exportData(kind) {
    const token = store.get();
    const res = await fetch(BASE + (kind === "json" ? "/export/json" : "/export/entries.csv"), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new ApiError(res.status, "Could not export");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = kind === "json" ? "orbit-export.json" : "orbit-entries.csv";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  },
  finSettings: () => request<FinSettings>("/fin/settings"),
  setFinSettings: (s) => patch<FinSettings>("/fin/settings", s),
};

export const api: Api = import.meta.env.VITE_DEMO ? demoApi : realApi;
