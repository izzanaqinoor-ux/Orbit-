export type Category = "study" | "work" | "personal" | "other";
export type PlanetColor = "study" | "work" | "personal" | "other" | "finance" | "rose" | "sand" | "violet";
export const PLANET_COLORS: PlanetColor[] = ["study", "work", "personal", "other", "rose", "sand", "violet", "finance"];
export interface Planet { id: string; name: string; kind: Category; color: PlanetColor }
export interface Term { id: string; kind: "term" | "break"; name: string; start_date: string; end_date: string }
export interface TermsInfo { terms: Term[]; current: Term | null; next: Term | null; needs_input: boolean; message: string | null }
export interface Job { id: string; name: string; hourly_rate: number | null; pay_basis: "hourly" | "monthly"; monthly_pay: number | null; unpaid_break_minutes: number; break_after_minutes: number; is_main: boolean }
export type NewJob = Omit<Job, "id" | "is_main">;
export interface StudyPlan { id: string; title: string; target_date: string | null; kind: "assignment" | "exam" | null; source_name: string | null }
export interface CommitmentPatch { title?: string; description?: string | null; planet_id?: string; start_at?: string; end_at?: string; estimated_duration_minutes?: number; due_at?: string | null; due_all_day?: boolean; time_off?: boolean }
export type Day = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
export const DAYS: Day[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export interface RecurrenceRule { freq: "weekly"; interval: number; days: Day[] }

export interface Commitment {
  id: string;
  title: string;
  description: string | null;
  mode: "fixed" | "flexible";
  status: "todo" | "in_progress" | "completed" | "skipped" | "archived";
  category: Category;
  planet_id: string | null;
  priority: number;
  start_at: string | null;
  end_at: string | null;
  due_at: string | null;
  due_all_day: boolean;
  estimated_duration_minutes: number | null;
  recurrence_rule: RecurrenceRule | null;
  recurrence_end_date: string | null;
  recurrence_template_id: string | null;
  occurrence_date: string | null;
  completed_at: string | null;
  goal_id?: string | null;
  time_off?: boolean;
}

export interface CommitmentDemand {
  commitment_id: string;
  title: string;
  due_at: string | null;
  due_all_day: boolean;
  estimated_duration_minutes: number;
  actual_minutes: number;
  planned_total_minutes: number;
  remaining_demand_minutes: number;
  unallocated_demand_minutes: number;
  unfulfilled_deadline_demand_minutes: number;
}

export interface WeekCapacity {
  week_start: string;
  week_end: string;
  weekly_capacity_minutes: number;
  fixed_occupied_minutes: number;
  planned_allocation_minutes: number;
  occupied_minutes: number;
  deadline_pressure_minutes: number;
  free_capacity_minutes: number;
  per_commitment_demand: CommitmentDemand[];
}

export interface CalendarItem {
  kind: "fixed" | "time_block" | "virtual_occurrence";
  commitment_id: string;
  title: string;
  category: Category;
  planet_id: string | null;
  start_at: string;
  end_at: string;
  status: string | null;
  is_virtual: boolean;
  occurrence_date: string | null;
  time_block_id: string | null;
}

export type NewCommitment =
  | { mode: "flexible"; title: string; planet_id: string; estimated_duration_minutes: number; due_at?: string | null; due_all_day?: boolean; description?: string | null; goal_id?: string | null }
  | { mode: "fixed"; title: string; planet_id: string; start_at: string; end_at: string; description?: string | null; time_off?: boolean;
      recurrence_rule?: RecurrenceRule | null; recurrence_end_date?: string | null };

export interface Api extends FinanceApi {
  planets(): Promise<Planet[]>;
  addPlanet(name: string, kind: Category, color: PlanetColor): Promise<Planet>;
  renamePlanet(id: string, name: string, color?: PlanetColor): Promise<void>;
  deletePlanet(id: string): Promise<void>;
  terms(): Promise<TermsInfo>;
  addTerm(t: { kind: "term" | "break"; name: string; start_date: string; end_date: string }): Promise<Term>;
  deleteTerm(id: string): Promise<void>;
  jobs(): Promise<Job[]>;
  addJob(j: NewJob): Promise<Job>;
  deleteJob(id: string): Promise<void>;
  setMainJob(id: string): Promise<void>;
  shiftJob(commitmentId: string): Promise<string | null>;
  setShiftJob(commitmentId: string, jobId: string): Promise<void>;
  occasions(start?: string, end?: string): Promise<Occasion[]>;
  addOccasion(o: { title: string; occurs_on: string; occurs_time?: string | null; repeats_yearly: boolean; note?: string | null }): Promise<void>;
  deleteOccasion(id: string): Promise<void>;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string): Promise<void>;
  logout(): void;
  isAuthed(): boolean;
  capacity(): Promise<WeekCapacity>;
  openDemand(): Promise<CommitmentDemand[]>;
  calendar(startISO: string, endISO: string): Promise<CalendarItem[]>;
  commitments(): Promise<Commitment[]>;
  createCommitment(c: NewCommitment): Promise<Commitment>;
  completeCommitment(id: string): Promise<void>;
  updateCommitment(id: string, patch: CommitmentPatch): Promise<Commitment>;
  moveTimeBlock(commitmentId: string, timeBlockId: string, startISO: string, endISO: string): Promise<void>;
  deleteTimeBlock(commitmentId: string, timeBlockId: string): Promise<void>;
  studyPlans(): Promise<StudyPlan[]>;
  createStudyPlan(p: { title: string; target_date: string | null; kind: "assignment" | "exam"; source_name: string | null }): Promise<StudyPlan>;
  deleteStudyPlan(id: string): Promise<void>;
  archiveCommitment(id: string): Promise<void>;
  addTimeBlock(commitmentId: string, startISO: string, endISO: string): Promise<void>;
  completeTimeBlock(commitmentId: string, timeBlockId: string, actualMinutes: number): Promise<void>;
  cancelOccurrence(templateId: string, date: string): Promise<void>;
  attendOccurrence(templateId: string, date: string): Promise<void>;
  examFocus(): Promise<ExamFocus>;
  preferences(): Promise<Prefs>;
  setPreferences(p: { features?: Partial<Record<FeatureKey, boolean>>; onboarded?: boolean }): Promise<Prefs>;
  notes(): Promise<Note[]>;
  addNote(n: { text: string; kind: Note["kind"]; page: string }): Promise<Note>;
  patchNote(id: string, p: { done?: boolean; text?: string }): Promise<Note>;
  deleteNote(id: string): Promise<void>;
  setExam(commitmentId: string): Promise<void>;
  exportData(kind: "json" | "csv"): Promise<void>;
}

// ── finance (personal rules engine) ──
export type Role = "spending" | "savings" | "earmarked";
export type Purpose = "main" | "emergency" | "travel" | "general" | "earmarked" | "other";
export interface Pocket { id: string; name: string; role: Role; purpose: Purpose; provider: string | null; is_liquid: boolean; balance_cents: number; opening_cents?: number; archived?: boolean }
export interface FinCat { id: string; name: string; kind: "income" | "expense"; counts_toward_cap: boolean; archived: boolean }
export interface HoldingPos {
  id: string; ticker: string; name: string | null; units: number; cost_cents: number; value_cents: number; price_cents: number | null; price_as_of: string | null;
  priced: boolean; units_missing: boolean; pl_cents: number | null; dividends_cents: number; shariah_note: string | null; archived: boolean;
}
export type EntryKind = "income" | "expense" | "transfer" | "contribution" | "dividend";
export interface Entry { id: string; kind: EntryKind; amount_cents: number; occurred_on: string; note: string | null; category_id: string | null; from_pocket_id: string | null; to_pocket_id: string | null; holding_id: string | null; units: string | number | null; recurring: boolean }
export interface WishItem { id: string; name: string; price_cents: number; category_id: string; note: string | null; verdict: PlanResult["verdict"]; flags: string[]; work_hours: number | null }
export interface NewEntry { kind: EntryKind; amount_cents: number; occurred_on?: string; note?: string | null; category_id?: string | null; from_pocket_id?: string | null; to_pocket_id?: string | null; holding_id?: string | null; units?: number | null; recurring?: boolean }
export interface RuleConfig {
  spending_cap_cents: number; liquidity_floor_cents: number; liquidity_comfort_cents: number | null; min_contribution_cents: number;
  save_invest_target: { low_cents: number; high_cents: number }; tolerance_pp: number;
  allocation: { key: string; label: string; pct: number; source: "spending" | "pocket" | "investment"; purpose?: string | null }[];
  portfolio: { ticker: string; pct: number }[];
  conditions: { liquidity_first: boolean; cap_warning: boolean; underweight_first: boolean; redirect_to: string };
}
export interface RuleSet { id: string; name: string; status: "current" | "historical"; effective_from: string | null; effective_to: string | null; note: string | null; config: RuleConfig }
export interface MilestoneRow { age: number; nw_low_cents: number; nw_high_cents: number | null; note: string | null }
export interface GoalView {
  id: string; title: string; kind: "pocket" | "investments" | "net_worth" | "custom"; pocket_id: string | null; target_date: string | null;
  target_cents: number; current_cents: number; remaining_cents: number; progress: number; required_monthly_cents: number | null;
  actual_monthly_cents: number; planned_monthly_cents: number | null; eta_months: number | null; status: "achieved" | "on_track" | "behind" | "overdue" | "no_deadline";
}
export interface PortRow { ticker: string; target_pct: number; current_pct: number; diff_pp: number; status: "overweight" | "underweight" | "at_target"; value_cents: number; cost_cents: number; pl_cents: number | null; units: number; price_cents: number | null; price_as_of: string | null; priced: boolean; units_missing: boolean; holding_id: string | null; in_targets: boolean }
export interface AllocRow { key: string; label: string; target_pct: number; target_cents: number; effective_target_cents: number; actual_cents: number; actual_pct: number; diff_cents: number; progress: number | null; redirected: "in" | "out" | null }
export interface Liquidity { liquid_cents: number; floor_cents: number; comfort_cents: number | null; gap_cents: number; status: "below" | "ok" | "healthy"; priority: "cash" | "invest"; message: string }
export interface Warning { code: string; level: "info" | "warn"; text: string }
export interface Dashboard {
  month: string; currency: string; today: string; hourly_rate_cents: number | null;
  income_cents: number; dividends_cents: number;
  expected_income: { items: { name: string; kind: string; cents: number; note: string | null }[]; work: { scheduled_hours: number; completed_hours: number; expected_hourly_pay_cents: number; monthly_pay_cents: number }; term_kind: string | null; total_cents: number };
  spending_cents: number; spending_all_cents: number; cap_cents: number; cap_base_cents: number; cap_cut_cents: number; cap_used: number | null; spending_by_category: Record<string, number>;
  savings_cents: number; investment_cents: number; savings_rate: number | null; investment_rate: number | null; save_invest_rate: number | null;
  save_invest_target: { low_cents: number; high_cents: number }; min_contribution_cents: number;
  pockets: Pocket[]; total_cash_cents: number; liquid_cash_cents: number; emergency_cents: number; travel_cents: number;
  liquidity: Liquidity; invest_priority: "cash" | "invest";
  portfolio: { total_cents: number; rows: PortRow[]; target_total_pct: number; max_drift_pp: number; cost_cents: number; pl_cents: number | null; suggestion: { ticker: string; amount_cents: number }[]; suggestion_amount_cents: number; suggestion_paused: boolean; dividends_cents: number };
  net_worth_cents: number; assets_cents: number; liabilities_cents: number; other_assets_cents: number;
  allocation: { total_pct: number; valid: boolean; unset: boolean; rows: AllocRow[] };
  goals: GoalView[];
  milestone: { age: number; checkpoint: MilestoneRow; status: "ahead" | "on_track" | "behind"; gap_to_low_cents: number; next: MilestoneRow | null; progress_to_next: number | null } | null;
  age: number | null; warnings: Warning[];
  chain: { hours: number; income: number; saved: number; invested: number; net_worth: number };
}
export interface NetworthHistory { snapshots: { month: string; net_worth_cents: number; cash_cents: number; investments_cents: number }[]; milestones: MilestoneRow[]; birth_date: string | null }
export interface PlanReq { name?: string; price_cents: number; category_id: string; pocket_id?: string | null }
export interface PlanResult { verdict: "fits" | "over_cap" | "below_floor" | "insufficient"; flags: string[]; facts: string[]; cap_left_cents: number; liquid_after_cents: number; pct_of_month_income: number | null; suggestion: string | null; name: string | null; investing_note: string | null; hourly_rate_cents: number | null; work_hours: number | null }
export interface GrowthPath { rate_pct: number; series: { year: number; value_cents: number; contributed_cents: number }[]; final_cents: number; contributed_cents: number; growth_cents: number; label: string }
export interface Scenario { id: string; name: string; kind: "growth" | "property"; params: Record<string, number | number[]>; result: { paths?: GrowthPath[] } & Record<string, unknown>; created_at: string }
export interface IncomeSource { id: string; name: string; kind: string; monthly_cents: number; pays_in_term: boolean; pays_in_break: boolean; active: boolean }
export interface FinSettings { birth_date: string | null; currency: string; valuation_day: number; exam_focus_days: number }
export interface Occasion { id: string; title: string; date: string; time: string | null; repeats_yearly: boolean; note: string | null; years: number | null; days_away: number }
export interface WeekSummary {
  week_start: string; week_end: string; currency: string; hours_scheduled: number; hours_so_far: number; expected_pay_cents: number; earned_so_far_cents: number;
  hourly_rate_cents: number; income_logged_cents: number; spent_cents: number; spent_toward_cap_cents: number; invested_cents: number; left_cents: number;
  weekly_cap_cents: number; spent_in_work_hours: number | null; top_categories: { name: string; cents: number }[];
}
export type FeatureKey = "study" | "work" | "finance" | "investing" | "planning" | "import" | "occasions" | "review";
export interface Note { id: string; kind: "note" | "feedback"; text: string; page: string; done: boolean; created_at: string }
export interface Prefs { features: Record<FeatureKey, boolean>; onboarded: boolean }
export interface ExamFocus { active: boolean; days: number; exam: { id: string; title: string; start_at: string; days_away: number } | null; study_hours_planned: number }
export interface Review extends WeekSummary {
  is_current: boolean; study_hours: number; focused_hours_by_kind: Record<string, number>; done: { title: string; category: Category }[]; done_count: number;
  cash_change_cents: number; cash_end_cents: number; goals: { title: string; progress: number; status: GoalView["status"] }[]; can_go_forward: boolean;
}
export type ImportStatus = "new" | "imported" | "logged" | "paired";
export interface ImportLineIn { pocket_id: string; date: string; amount_cents: number; description: string; balance_cents?: number | null }
export interface ImportLine { i: number; fp_key: string; pocket_id: string; date: string; amount_cents: number; description: string; status: ImportStatus; imported_as: string | null; entry_id: string | null; pair_with: number | null; category_id: string | null; hint: string | null }
export interface ImportPreview { rows: ImportLine[]; counts: Partial<Record<ImportStatus, number>> }
export interface ImportCommitRow extends ImportLineIn { action: "expense" | "income" | "transfer" | "skip" | "link"; category_id?: string | null; other_pocket_id?: string | null; pair_key?: string | null; link_entry_id?: string | null }
export interface ImportResult { counts: { booked: number; transfers: number; skipped: number; linked: number; already_imported: number }; balance_checks: { pocket_id: string; name: string; as_of: string; bank_cents: number; orbit_cents: number; diff_cents: number }[] }
export interface ImportSummaryRow { pocket_id: string; name: string; lines: number; first: string | null; last: string | null }
export interface JournalLine { account: string; dr_cents: number; cr_cents: number }
export interface JournalEntry { entry_id: string; date: string; kind: EntryKind; memo: string | null; lines: JournalLine[] }
export interface StatementClose { expected_cents: number; actual_cents: number; diff_cents: number; destination_pocket_id: string | null; cap_cut_cents: number }
export interface StatementPocket { pocket_id: string; name: string; role: Role; opening_cents: number; in_cents: number; out_cents: number; closing_cents: number; close: StatementClose | null }
export interface Statement {
  month: string; currency: string; journal: JournalEntry[]; totals: { dr_cents: number; cr_cents: number; tallies: boolean }; pockets: StatementPocket[];
  suggestion: { pocket_id: string; name: string; reason: string } | null; next_month_cap: { base_cents: number; cut_cents: number; effective_cents: number }; is_future: boolean;
}
export interface ValuationHolding { id: string; ticker: string; name: string | null; units: number; cost_cents: number; book_value_cents: number; last_value_cents: number | null; recorded_this_month: boolean }
export interface ValuationRow { month: string; recorded_on: string; value_cents: number; cost_cents: number; gain_cents: number; gain_pct: number | null; month_return: number | null; by_holding: { ticker: string; value_cents: number }[] }
export interface Valuations { valuation_day: number; due: boolean; due_month: string | null; holdings: ValuationHolding[]; history: ValuationRow[]; latest: ValuationRow | null; cumulative_return: number | null; next_check_in: string }

export interface FinanceApi {
  dashboard(month?: string): Promise<Dashboard>;
  networth(): Promise<NetworthHistory>;
  plan(r: PlanReq): Promise<PlanResult>;
  pockets(): Promise<Pocket[]>;
  addPocket(p: { name: string; role: Role; purpose: Purpose; provider?: string | null; is_liquid: boolean; opening_cents: number }): Promise<void>;
  patchPocket(id: string, p: Partial<{ name: string; provider: string | null; is_liquid: boolean; opening_cents: number; archived: boolean }>): Promise<void>;
  categories(): Promise<FinCat[]>;
  addCategory(c: { name: string; kind: "income" | "expense"; counts_toward_cap: boolean }): Promise<void>;
  patchCategory(id: string, c: Partial<{ name: string; counts_toward_cap: boolean; archived: boolean }>): Promise<void>;
  holdings(): Promise<HoldingPos[]>;
  addHolding(h: { ticker: string; name?: string | null; opening_units?: number; opening_cost_cents?: number; shariah_note?: string | null }): Promise<void>;
  patchHolding(id: string, h: Partial<{ price_cents: number; shariah_note: string | null; archived: boolean; opening_units: number; opening_cost_cents: number }>): Promise<void>;
  entries(month?: string): Promise<Entry[]>;
  addEntry(e: NewEntry): Promise<Entry>;
  updateEntry(id: string, e: NewEntry): Promise<Entry>;
  deleteEntry(id: string): Promise<void>;
  wishlist(): Promise<WishItem[]>;
  addWish(w: { name: string; price_cents: number; category_id: string; note?: string | null }): Promise<void>;
  removeWish(id: string): Promise<void>;
  addFinGoal(g: { title: string; kind: GoalView["kind"]; pocket_id?: string | null; target_cents: number; target_date?: string | null; planned_monthly_cents?: number | null; manual_current_cents?: number | null }): Promise<void>;
  patchFinGoal(id: string, g: Partial<{ title: string; target_cents: number; target_date: string | null; planned_monthly_cents: number | null; archived: boolean }>): Promise<void>;
  rules(): Promise<RuleSet[]>;
  saveRules(config: RuleConfig): Promise<RuleSet>;
  milestones(): Promise<MilestoneRow[]>;
  putMilestone(m: MilestoneRow): Promise<void>;
  deleteMilestone(age: number): Promise<void>;
  scenarios(): Promise<Scenario[]>;
  addScenario(s: { name: string; kind: "growth" | "property"; params: Record<string, number | number[]> }): Promise<Scenario>;
  deleteScenario(id: string): Promise<void>;
  incomeSources(): Promise<IncomeSource[]>;
  saveIncomeSource(s: Omit<IncomeSource, "id"> & { id?: string }): Promise<void>;
  deleteIncomeSource(id: string): Promise<void>;
  weekSummary(start?: string): Promise<WeekSummary>;
  statement(month?: string): Promise<Statement>;
  settleStatement(month: string, items: { pocket_id: string; actual_cents: number; destination_pocket_id?: string | null }[]): Promise<Statement>;
  undoSettle(month: string, pocketId: string): Promise<Statement>;
  valuations(): Promise<Valuations>;
  recordValuations(values: { holding_id: string; value_cents: number }[], month?: string): Promise<Valuations>;
  importPreview(rows: ImportLineIn[]): Promise<ImportPreview>;
  importCommit(rows: ImportCommitRow[]): Promise<ImportResult>;
  importSummary(): Promise<ImportSummaryRow[]>;
  review(week?: string): Promise<Review>;
  finSettings(): Promise<FinSettings>;
  setFinSettings(s: Partial<FinSettings>): Promise<FinSettings>;
}
