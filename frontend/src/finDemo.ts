/**
 * Demo-only finance backend (in-memory) + a TypeScript port of backend/app/services/fin_engine.py.
 * The real app always asks the server; this exists so the shareable preview works without one.
 */
import { mainRateCents } from "./demoJobs";
import type {
  AllocRow, Dashboard, Entry, FinCat, GoalView, GrowthPath, HoldingPos, IncomeSource, Liquidity, MilestoneRow, NewEntry, PlanResult,
  PortRow, Pocket, RuleConfig, RuleSet, Scenario, Warning, FinanceApi, WishItem, WeekSummary, Statement, Valuations, ValuationRow, StatementPocket, ImportLine, ImportLineIn, ImportCommitRow, ImportPreview, ImportResult, ImportSummaryRow, Review,
} from "./types";

export const money = (c: number, cur = "SGD") => {
  const a = Math.abs(Math.round(c)), sym = cur === "SGD" ? "S$" : cur + " ";
  const body = a % 100 === 0 ? (a / 100).toLocaleString("en-US") : (a / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${c < 0 ? "-" : ""}${sym}${body}`;
};

// ── engine port ──
function liquidity(liquid: number, floor: number, comfort: number | null): Liquidity {
  const gap = liquid - floor;
  if (liquid < floor) return { liquid_cents: liquid, floor_cents: floor, comfort_cents: comfort, gap_cents: gap, status: "below", priority: "cash",
    message: `Liquid cash (${money(liquid)}) is ${money(-gap)} below your minimum buffer of ${money(floor)}. Prioritise rebuilding cash before making additional investment contributions.` };
  if (comfort && liquid < comfort) return { liquid_cents: liquid, floor_cents: floor, comfort_cents: comfort, gap_cents: gap, status: "ok", priority: "invest",
    message: `Liquid cash is above your minimum buffer by ${money(gap)}, still short of your comfortable level of ${money(comfort)}.` };
  return { liquid_cents: liquid, floor_cents: floor, comfort_cents: comfort, gap_cents: gap, status: "healthy", priority: "invest",
    message: `Liquid cash is healthy — ${money(gap)} above your minimum buffer. Normal investing can continue.` };
}

function portfolioRows(hs: { ticker: string; value: number; priced: boolean }[], targets: { ticker: string; pct: number }[], tol: number) {
  const tickers = [...targets.map((t) => t.ticker), ...hs.map((h) => h.ticker).filter((t) => !targets.some((x) => x.ticker === t))];
  const total = hs.reduce((n, h) => n + h.value, 0);
  const rows = tickers.map((t) => {
    const v = hs.find((h) => h.ticker === t)?.value ?? 0, tg = targets.find((x) => x.ticker === t)?.pct ?? 0;
    const cur = total > 0 ? (v / total) * 100 : 0, diff = cur - tg;
    const status: PortRow["status"] = total === 0 ? (tg === 0 ? "at_target" : "underweight") : Math.abs(diff) <= tol ? "at_target" : diff > 0 ? "overweight" : "underweight";
    return { ticker: t, target_pct: tg, current_pct: +cur.toFixed(2), diff_pp: +diff.toFixed(2), status, value_cents: v, in_targets: tg > 0 || targets.some((x) => x.ticker === t) } as PortRow;
  });
  return { total, rows, maxDrift: total > 0 ? Math.max(0, ...rows.map((r) => Math.abs(r.diff_pp))) : 0 };
}

function suggest(rows: PortRow[], total: number, amount: number) {
  const tg = rows.filter((r) => r.target_pct > 0);
  if (amount <= 0 || !tg.length) return [];
  const after = total + amount;
  const short = tg.map((r) => Math.max(0, Math.round((after * r.target_pct) / 100) - r.value_cents));
  const need = short.reduce((a, b) => a + b, 0);
  const alloc = tg.map((r, i) => (need >= amount ? Math.floor((amount * short[i]) / need) : short[i] + Math.floor(((amount - need) * r.target_pct) / tg.reduce((n, x) => n + x.target_pct, 0))));
  const left = amount - alloc.reduce((a, b) => a + b, 0);
  if (left) alloc[short.indexOf(Math.max(...short))] += left;
  return tg.map((r, i) => ({ ticker: r.ticker, amount_cents: alloc[i] })).filter((x) => x.amount_cents > 0).sort((a, b) => b.amount_cents - a.amount_cents);
}

const monthsLeft = (from: Date, to: Date) => (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + (to.getDate() > from.getDate() ? 1 : 0);
function goalMetrics(target: number, current: number, date: string | null, pace: number, planned: number | null, today: Date) {
  const remaining = Math.max(0, target - current);
  const out = { target_cents: target, current_cents: current, remaining_cents: remaining, progress: Math.min(1, current / target), required_monthly_cents: null as number | null,
    actual_monthly_cents: pace, planned_monthly_cents: planned, eta_months: pace > 0 && remaining > 0 ? Math.ceil(remaining / pace) : null, status: "no_deadline" as GoalView["status"] };
  if (remaining === 0) { out.status = "achieved"; return out; }
  if (!date) return out;
  const left = monthsLeft(today, new Date(date));
  if (left <= 0) { out.status = "overdue"; out.required_monthly_cents = remaining; return out; }
  out.required_monthly_cents = Math.ceil(remaining / left);
  out.status = pace >= out.required_monthly_cents ? "on_track" : "behind";
  return out;
}

function milestoneStatus(nw: number, age: number, ms: MilestoneRow[]) {
  if (!ms.length) return null;
  const s = [...ms].sort((a, b) => a.age - b.age), passed = s.filter((m) => m.age <= age), cp = passed.length ? passed[passed.length - 1] : s[0], nxt = s.find((m) => m.age > age) ?? null;
  const status = cp.nw_high_cents != null && nw > cp.nw_high_cents ? "ahead" : nw >= cp.nw_low_cents ? "on_track" : "behind";
  return { age, checkpoint: cp, status: status as "ahead" | "on_track" | "behind", gap_to_low_cents: nw - cp.nw_low_cents, next: nxt, progress_to_next: nxt ? Math.min(1, Math.max(0, nw / nxt.nw_low_cents)) : null };
}

const growth = (start: number, monthly: number, rate: number, years: number): Omit<GrowthPath, "rate_pct"> => {
  const r = rate / 100 / 12; let bal = start, contributed = start;
  const series = [{ year: 0, value_cents: Math.round(bal), contributed_cents: contributed }];
  for (let m = 1; m <= years * 12; m++) { bal = bal * (1 + r) + monthly; contributed += monthly; if (m % 12 === 0) series.push({ year: m / 12, value_cents: Math.round(bal), contributed_cents: contributed }); }
  return { series, final_cents: Math.round(bal), contributed_cents: contributed, growth_cents: Math.round(bal - contributed), label: "Assumption, not a forecast" };
};
const property = (price: number, downPct: number, rate: number, years: number, have: number, save: number) => {
  const down = Math.round((price * downPct) / 100), loan = price - down, n = years * 12, r = rate / 100 / 12;
  const pay = r > 0 ? Math.round((loan * r) / (1 - (1 + r) ** -n)) : Math.round(loan / n), gap = Math.max(0, down - have);
  return { down_payment_cents: down, loan_cents: loan, monthly_payment_cents: pay, gap_to_down_cents: gap, months_to_down: gap === 0 ? 0 : save > 0 ? Math.ceil(gap / save) : null,
    label: "Scenario only — property affordability depends on rules and prices outside your control" };
};

// ── state ──
let n = 0;
const id = () => `f${++n}`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = new Date();
const monthStr = ymd(today).slice(0, 7);
const day = (d: number, back = 0) => { const x = new Date(today.getFullYear(), today.getMonth() - back, Math.min(d, back ? 28 : today.getDate())); return ymd(x); };

const pk = (name: string, role: Pocket["role"], purpose: Pocket["purpose"], provider: string | null, liquid: boolean, opening: number): Pocket & { opening_cents: number } =>
  ({ id: id(), name, role, purpose, provider, is_liquid: liquid, balance_cents: 0, opening_cents: opening, archived: false });
const P = { main: pk("Main account", "spending", "main", null, true, 0), emer: pk("Emergency cash", "savings", "emergency", "GXS", true, 18000), travel: pk("Travel fund", "savings", "travel", "GXS", true, 9000),
  general: pk("General savings", "savings", "general", "GXS", true, 12000), car: pk("Car licence fund", "earmarked", "earmarked", null, false, 250000) };
const cat = (name: string, kind: FinCat["kind"], cap: boolean): FinCat => ({ id: id(), name, kind, counts_toward_cap: cap, archived: false });
const C = Object.fromEntries([["Food", true], ["Transport", true], ["Daily spending", true], ["Going out", true], ["Shopping", true], ["Subscriptions", true], ["iCloud", true], ["Spotify", true], ["Other necessary", true], ["Car licence", false]]
  .map(([n, c]) => [n as string, cat(n as string, "expense", c as boolean)])) as Record<string, FinCat>;
const I = Object.fromEntries(["Part-time", "Allowance", "Internship", "Full-time", "Freelance / side", "Other income"].map((n) => [n, cat(n, "income", false)])) as Record<string, FinCat>;

const defaultRules = (): RuleConfig => ({
  spending_cap_cents: 30000, liquidity_floor_cents: 30000, liquidity_comfort_cents: 50000, min_contribution_cents: 10000, save_invest_target: { low_cents: 25000, high_cents: 40000 }, tolerance_pp: 5,
  allocation: [
    { key: "spending", label: "Spending", pct: 30, source: "spending" }, { key: "emergency", label: "Emergency cash", pct: 15, source: "pocket", purpose: "emergency" },
    { key: "travel", label: "Travel fund", pct: 5, source: "pocket", purpose: "travel" }, { key: "general", label: "General savings", pct: 10, source: "pocket", purpose: "general" },
    { key: "investments", label: "Investments", pct: 35, source: "investment" }, { key: "other", label: "Other goals", pct: 5, source: "pocket", purpose: "other" }],
  portfolio: [{ ticker: "SPUS", pct: 60 }, { ticker: "G3B", pct: 25 }, { ticker: "AAPL", pct: 15 }],
  conditions: { liquidity_first: true, cap_warning: true, underweight_first: true, redirect_to: "emergency" },
});
const WISHES: { id: string; name: string; price_cents: number; category_id: string; note: string | null }[] = [];
const S = {
  pockets: Object.values(P), cats: [...Object.values(C), ...Object.values(I)], entries: [] as Entry[],
  holdings: [
    { id: id(), ticker: "SPUS", name: "SP Funds S&P 500 Sharia ETF", price_cents: 4620, price_as_of: day(1), opening_units: 6, opening_cost_cents: 24000, shariah_note: "Screened by the fund; my own review pending.", archived: false },
    { id: id(), ticker: "AAPL", name: "Apple", price_cents: 21300, price_as_of: day(1), opening_units: 0.5, opening_cost_cents: 9800, shariah_note: null, archived: false },
    { id: id(), ticker: "G3B", name: "Singapore STI ETF", price_cents: 0, price_as_of: null as string | null, opening_units: 0, opening_cost_cents: 0, shariah_note: null, archived: false },
  ] as { id: string; ticker: string; name: string | null; price_cents: number | null; price_as_of: string | null; opening_units: number; opening_cost_cents: number; shariah_note: string | null; archived: boolean }[],
  goals: [] as { id: string; title: string; kind: GoalView["kind"]; pocket_id: string | null; target_cents: number; target_date: string | null; planned_monthly_cents: number | null; manual: number | null; archived: boolean }[],
  rules: [{ id: id(), name: "Current rules", status: "current", effective_from: day(1), effective_to: null, note: null, config: defaultRules() }] as RuleSet[],
  milestones: [[19, 5000, null], [20, 8000, 12000], [21, 15000, 20000], [22, 20000, 30000], [24, 60000, 100000], [27, 200000, 300000], [30, 500000, 1000000]]
    .map(([a, l, h]) => ({ age: a as number, nw_low_cents: (l as number) * 100, nw_high_cents: h ? (h as number) * 100 : null, note: null })) as MilestoneRow[],
  scenarios: [] as Scenario[],
  sources: [{ id: id(), name: "Allowance", kind: "allowance", monthly_cents: 20000, pays_in_term: true, pays_in_break: false, active: true }] as IncomeSource[],
  birth: "2007-03-01" as string | null,
  valDay: 1,
  examDays: 7,
  imp: [] as { fp: string; pocket_id: string; date: string; amt: number; desc: string; entry_id: string | null }[],
  rulesImp: {} as Record<string, string>,
  vals: [] as { holding_id: string; month: string; value_cents: number; recorded_on: string }[],
  closes: [] as { month: string; pocket_id: string; expected_cents: number; actual_cents: number; diff_cents: number; destination_pocket_id: string | null; cap_cut_cents: number; entry_ids: string[] }[],
  snapshots: [{ month: ymd(new Date(today.getFullYear(), today.getMonth() - 3, 1)).slice(0, 7), nw: 61000 }, { month: ymd(new Date(today.getFullYear(), today.getMonth() - 2, 1)).slice(0, 7), nw: 78500 }, { month: ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)).slice(0, 7), nw: 96000 }],
};
S.goals.push({ id: id(), title: "Emergency cash to S$1,800", kind: "pocket", pocket_id: P.emer.id, target_cents: 180000, target_date: null, planned_monthly_cents: 15000, manual: null, archived: false },
  { id: id(), title: "Japan trip", kind: "pocket", pocket_id: P.travel.id, target_cents: 200000, target_date: ymd(new Date(today.getFullYear() + 1, 5, 1)), planned_monthly_cents: null, manual: null, archived: false });

const E = (kind: Entry["kind"], amt: number, d: string, o: Partial<Entry>): void => { S.entries.push({ id: id(), kind, amount_cents: amt, occurred_on: d, note: null, category_id: null, from_pocket_id: null, to_pocket_id: null, holding_id: null, units: null, recurring: false, ...o }); };
for (const back of [1, 0]) {
  E("income", 62000, day(21, back), { category_id: I["Part-time"].id, to_pocket_id: P.main.id });
  E("income", 20000, day(1, back), { category_id: I["Allowance"].id, to_pocket_id: P.main.id });
  E("expense", 4000, day(2, back), { category_id: C["Transport"].id, from_pocket_id: P.main.id, recurring: true });
  E("expense", 9500, day(3, back), { category_id: C["Food"].id, from_pocket_id: P.main.id });
  E("expense", 4200, day(5, back), { category_id: C["Going out"].id, from_pocket_id: P.main.id });
  E("expense", 1300, day(6, back), { category_id: C["Subscriptions"].id, from_pocket_id: P.main.id, recurring: true });
  E("transfer", 15000, day(7, back), { from_pocket_id: P.main.id, to_pocket_id: P.emer.id });
  E("transfer", 5000, day(7, back), { from_pocket_id: P.main.id, to_pocket_id: P.travel.id });
  if (back === 1) E("contribution", 10000, day(8, back), { holding_id: S.holdings[0].id, from_pocket_id: P.main.id, units: 2.2 });
}
E("expense", 12000, day(4, 0), { category_id: C["Car licence"].id, from_pocket_id: P.car.id, note: "Theory lessons" });
E("expense", 3000, day(2, 0), { category_id: C["Daily spending"].id, from_pocket_id: P.main.id });
E("income", 8000, day(3, 0), { category_id: I["Freelance / side"].id, to_pocket_id: P.main.id });
{
  const sp = S.holdings[0].id, ap = S.holdings[1].id, mk = (back: number) => ymd(new Date(today.getFullYear(), today.getMonth() - back, 1)).slice(0, 7);
  S.vals.push({ holding_id: sp, month: mk(2), value_cents: 27000, recorded_on: day(3, 2) }, { holding_id: ap, month: mk(2), value_cents: 10400, recorded_on: day(3, 2) },
    { holding_id: sp, month: mk(1), value_cents: 37400, recorded_on: day(20, 1) }, { holding_id: ap, month: mk(1), value_cents: 10600, recorded_on: day(20, 1) });
}

// ── computations ──
const inMonth = (e: Entry, m: string) => e.occurred_on.startsWith(m);
const prevMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return ymd(new Date(y, mo - 2, 1)).slice(0, 7); };
function balances(upto?: string): Record<string, number> {
  const b: Record<string, number> = {};
  for (const p of S.pockets) b[p.id] = p.opening_cents ?? 0;
  for (const e of S.entries) {
    if (upto && e.occurred_on >= upto) continue; if (e.to_pocket_id) b[e.to_pocket_id] += e.amount_cents; if (e.from_pocket_id) b[e.from_pocket_id] -= e.amount_cents; }
  return b;
}
function positions(): HoldingPos[] {
  return S.holdings.map((h) => {
    const cs = S.entries.filter((e) => e.kind === "contribution" && e.holding_id === h.id), miss = cs.some((e) => e.units == null);
    const units = h.opening_units + cs.reduce((a, e) => a + Number(e.units ?? 0), 0), cost = h.opening_cost_cents + cs.reduce((a, e) => a + e.amount_cents, 0);
    const priced = !!h.price_cents && !miss && units > 0, value = priced ? Math.round(units * (h.price_cents as number)) : cost;
    return { id: h.id, ticker: h.ticker, name: h.name, units, cost_cents: cost, value_cents: value, price_cents: h.price_cents, price_as_of: h.price_as_of, priced, units_missing: miss,
      pl_cents: priced ? value - cost : null, dividends_cents: S.entries.filter((e) => e.kind === "dividend" && e.holding_id === h.id).reduce((a, e) => a + e.amount_cents, 0), shariah_note: h.shariah_note, archived: h.archived };
  });
}
const cfg = () => S.rules.find((r) => r.status === "current")!.config;

function dashboard(month?: string): Dashboard {
  const m = month ?? monthStr, c = cfg(), bal = balances();
  const pockets = S.pockets.filter((p) => !p.archived).map((p) => ({ ...p, balance_cents: bal[p.id] }));
  const role = (pid: string | null) => S.pockets.find((p) => p.id === pid);
  const catOf = (cid: string | null) => S.cats.find((x) => x.id === cid);
  const stats = (mm: string) => {
    let income = 0, div = 0, cap = 0, all = 0, contrib = 0, save = 0, wd = 0; const byCat: Record<string, number> = {}, alloc: Record<string, number> = {};
    for (const e of S.entries.filter((x) => inMonth(x, mm))) {
      const fp = role(e.from_pocket_id), tp = role(e.to_pocket_id);
      if (e.kind === "income") income += e.amount_cents; else if (e.kind === "dividend") div += e.amount_cents;
      else if (e.kind === "expense") { const cc = catOf(e.category_id); all += e.amount_cents; if (!cc || cc.counts_toward_cap) cap += e.amount_cents; byCat[cc?.name ?? "Uncategorised"] = (byCat[cc?.name ?? "Uncategorised"] ?? 0) + e.amount_cents; if (fp?.role === "savings") wd += e.amount_cents; }
      else if (e.kind === "contribution") { contrib += e.amount_cents; alloc.investments = (alloc.investments ?? 0) + e.amount_cents; }
      const toS = tp?.role === "savings", fromS = fp?.role === "savings";
      if (toS && !fromS && ["income", "transfer", "dividend"].includes(e.kind)) save += e.amount_cents;
      if (fromS && !toS && e.kind === "transfer") save -= e.amount_cents;
      if (fromS && e.kind === "expense") save -= e.amount_cents;
      if (tp && ["income", "transfer"].includes(e.kind) && !(fp && fp.purpose === tp.purpose)) alloc[`p:${tp.purpose}`] = (alloc[`p:${tp.purpose}`] ?? 0) + e.amount_cents;
      if (fp && e.kind === "transfer" && tp && fp.role === "savings" && tp.role !== "savings") alloc[`p:${fp.purpose}`] = (alloc[`p:${fp.purpose}`] ?? 0) - e.amount_cents;
    }
    return { income, div, cap, all, contrib, save, byCat, alloc, wd };
  };
  const a = stats(m), pv = stats(prevMonth(m));
  const capCut = S.closes.filter((x) => x.month === prevMonth(m)).reduce((n, x) => n + x.cap_cut_cents, 0), eff = Math.max(0, c.spending_cap_cents - capCut);
  const inc = a.income + a.div, rate = (s: ReturnType<typeof stats>) => (s.income + s.div > 0 ? s.save / (s.income + s.div) : null);
  const total = pockets.reduce((n, p) => n + p.balance_cents, 0), liquid = pockets.filter((p) => p.is_liquid).reduce((n, p) => n + p.balance_cents, 0);
  const purp = (k: string) => pockets.filter((p) => p.purpose === k).reduce((n, p) => n + p.balance_cents, 0);
  const liq = liquidity(liquid, c.liquidity_floor_cents, c.liquidity_comfort_cents);
  const pos = positions().filter((p) => !p.archived || p.value_cents > 0);
  const pr = portfolioRows(pos.map((p) => ({ ticker: p.ticker, value: p.value_cents, priced: p.priced })), c.portfolio, c.tolerance_pp);
  for (const r of pr.rows) { const p = pos.find((x) => x.ticker === r.ticker); Object.assign(r, { cost_cents: p?.cost_cents ?? 0, pl_cents: p?.pl_cents ?? null, units: p?.units ?? 0, price_cents: p?.price_cents ?? null, price_as_of: p?.price_as_of ?? null, priced: p?.priced ?? false, units_missing: p?.units_missing ?? false, holding_id: p?.id ?? null }); }
  const cashFirst = c.conditions.liquidity_first && liq.priority === "cash";
  const netWorth = total + pr.total;
  const rows = c.allocation.map((l): AllocRow => {
    const act = l.source === "spending" ? a.cap : l.source === "investment" ? a.contrib : a.alloc[`p:${l.purpose}`] ?? 0, t = Math.round((inc * l.pct) / 100);
    return { key: l.key, label: l.label, target_pct: l.pct, target_cents: t, effective_target_cents: t, actual_cents: act, actual_pct: inc > 0 ? +((act / inc) * 100).toFixed(2) : 0, diff_cents: act - t, progress: t > 0 ? act / t : null, redirected: null };
  });
  if (cashFirst) { const s = rows.find((r) => r.key === "investments"), d = rows.find((r) => r.key === c.conditions.redirect_to); if (s && d && s.target_cents > 0) { d.effective_target_cents += s.target_cents; d.redirected = "in"; s.effective_target_cents = 0; s.redirected = "out"; } }
  const totalPct = c.allocation.reduce((n, l) => n + l.pct, 0);
  const three = new Date(today.getFullYear(), today.getMonth() - 3, 1);
  const goals: GoalView[] = S.goals.filter((g) => !g.archived).map((g) => {
    let cur = 0, pace = 0;
    if (g.kind === "pocket") { cur = Math.max(0, bal[g.pocket_id!] ?? 0); for (const e of S.entries) if (new Date(e.occurred_on) >= three) { if (e.to_pocket_id === g.pocket_id && e.from_pocket_id !== g.pocket_id) pace += e.amount_cents; if (e.from_pocket_id === g.pocket_id) pace -= e.amount_cents; } pace = Math.floor(Math.max(0, pace) / 3); }
    else if (g.kind === "investments") { cur = pr.total; pace = Math.floor(S.entries.filter((e) => e.kind === "contribution" && new Date(e.occurred_on) >= three).reduce((x, e) => x + e.amount_cents, 0) / 3); }
    else if (g.kind === "net_worth") cur = Math.max(0, netWorth); else cur = g.manual ?? 0;
    return { id: g.id, title: g.title, kind: g.kind, pocket_id: g.pocket_id, target_date: g.target_date, ...goalMetrics(g.target_cents, cur, g.target_date, pace, g.planned_monthly_cents, today) };
  });
  const age = S.birth ? Math.floor((today.getTime() - new Date(S.birth).getTime()) / (365.25 * 864e5)) : null;
  const warns: Warning[] = [];
  if (c.conditions.cap_warning && a.cap > eff) warns.push({ code: "cap", level: "warn", text: `Spending is ${money(a.cap - eff)} above your ${money(eff)} cap this month.` });
  if (liq.status === "below") warns.push({ code: "liquidity", level: "warn", text: liq.message });
  if (pr.total > 0 && pr.maxDrift > c.tolerance_pp * 2) warns.push({ code: "allocation", level: "warn", text: `Your portfolio is ${pr.maxDrift.toFixed(0)} percentage points from target on its biggest gap — direct new contributions to underweight holdings.` });
  for (const g of goals) if (g.status === "behind") warns.push({ code: "goal", level: "info", text: `“${g.title}” needs ${money(g.required_monthly_cents ?? 0)}/month to hit its date; recent pace is ${money(g.actual_monthly_cents)}.` });
  const r1 = rate(a), r0 = rate(pv);
  if (r1 != null && r0 != null && r1 < r0 - 0.05) warns.push({ code: "rate", level: "info", text: `Your savings rate dipped from ${Math.round(r0 * 100)}% to ${Math.round(r1 * 100)}% month on month.` });
  if (a.contrib === 0 && pv.contrib === 0) warns.push({ code: "skipped", level: "info", text: "No investment contribution recorded last month or so far this month." });
  else if (a.contrib > 0 && a.contrib < c.min_contribution_cents) warns.push({ code: "below_min", level: "info", text: `Contributions so far this month (${money(a.contrib)}) are under your ${money(c.min_contribution_cents)} minimum.` });
  if (a.wd > 0) warns.push({ code: "withdrawal", level: "warn", text: `${money(a.wd)} was spent straight out of a savings pocket this month.` });
  const sug = c.conditions.underweight_first ? suggest(pr.rows, pr.total, c.min_contribution_cents) : [];
  const allow = S.sources.filter((s) => s.active).map((s) => ({ name: s.name, kind: s.kind, cents: s.monthly_cents, note: "term dates not entered — assumed paid" as string | null }));
  return {
    month: m, currency: "SGD", today: ymd(today), hourly_rate_cents: mainRateCents(), income_cents: a.income, dividends_cents: a.div,
    expected_income: { items: allow, work: { scheduled_hours: 36, completed_hours: 24, expected_hourly_pay_cents: 39600, monthly_pay_cents: 0 }, term_kind: null, total_cents: allow.reduce((n, x) => n + x.cents, 0) + 39600 },
    spending_cents: a.cap, spending_all_cents: a.all, cap_cents: eff, cap_base_cents: c.spending_cap_cents, cap_cut_cents: capCut, cap_used: eff ? a.cap / eff : null, spending_by_category: a.byCat,
    savings_cents: a.save, investment_cents: a.contrib, savings_rate: r1, investment_rate: inc > 0 ? a.contrib / inc : null, save_invest_rate: inc > 0 ? (a.save + a.contrib) / inc : null,
    save_invest_target: c.save_invest_target, min_contribution_cents: c.min_contribution_cents, pockets, total_cash_cents: total, liquid_cash_cents: liquid,
    emergency_cents: purp("emergency"), travel_cents: purp("travel"), liquidity: liq, invest_priority: cashFirst ? "cash" : "invest",
    portfolio: { total_cents: pr.total, rows: pr.rows, target_total_pct: c.portfolio.reduce((n, x) => n + x.pct, 0), max_drift_pp: pr.maxDrift, cost_cents: pos.reduce((n, p) => n + p.cost_cents, 0),
      pl_cents: pos.some((p) => p.priced) ? pr.total - pos.reduce((n, p) => n + p.cost_cents, 0) : null, suggestion: sug, suggestion_amount_cents: c.min_contribution_cents, suggestion_paused: cashFirst, dividends_cents: 0 },
    net_worth_cents: netWorth, assets_cents: netWorth, liabilities_cents: 0, other_assets_cents: 0,
    allocation: { total_pct: totalPct, valid: Math.abs(totalPct - 100) < 0.01, unset: totalPct === 0, rows }, goals, milestone: age != null ? milestoneStatus(netWorth, age, S.milestones) : null, age, warnings: warns,
    chain: { hours: 24, income: inc, saved: a.save, invested: a.contrib, net_worth: netWorth },
  };
}

const monday = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
function weekSummary(start?: string): WeekSummary {
  const mon = monday(start ? new Date(start + "T00:00") : new Date()), s0 = ymd(mon), s1 = ymd(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 7)), sun = ymd(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6));
  const es = S.entries.filter((e) => e.occurred_on >= s0 && e.occurred_on < s1), catOf = (cid: string | null) => S.cats.find((x) => x.id === cid);
  const spent = es.filter((e) => e.kind === "expense"), cap = spent.filter((e) => catOf(e.category_id)?.counts_toward_cap !== false).reduce((n, e) => n + e.amount_cents, 0);
  const total = spent.reduce((n, e) => n + e.amount_cents, 0), income = es.filter((e) => e.kind === "income").reduce((n, e) => n + e.amount_cents, 0);
  const byCat: Record<string, number> = {}; for (const e of spent) byCat[catOf(e.category_id)?.name ?? "Uncategorised"] = (byCat[catOf(e.category_id)?.name ?? "Uncategorised"] ?? 0) + e.amount_cents;
  const todayIdx = (new Date().getDay() + 6) % 7, shiftDays = [1, 5], rate = mainRateCents() ?? 0, hrs = 5;
  const so = shiftDays.filter((d) => d <= todayIdx && ymd(new Date()) >= s0).length * hrs, c = cfg();
  const capNow = Math.max(0, c.spending_cap_cents - S.closes.filter((x) => x.month === prevMonth(monthStr)).reduce((n, x) => n + x.cap_cut_cents, 0)), dim = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return { week_start: s0, week_end: sun, currency: "SGD", hours_scheduled: shiftDays.length * hrs, hours_so_far: so, expected_pay_cents: shiftDays.length * hrs * rate, earned_so_far_cents: so * rate,
    hourly_rate_cents: rate, income_logged_cents: income, spent_cents: total, spent_toward_cap_cents: cap, invested_cents: es.filter((e) => e.kind === "contribution").reduce((n, e) => n + e.amount_cents, 0),
    left_cents: income - total, weekly_cap_cents: Math.round((capNow * 7) / dim), spent_in_work_hours: total > 0 && rate > 0 ? +(total / rate).toFixed(1) : null,
    top_categories: Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, cents]) => ({ name, cents })) };
}

function statement(month?: string): Statement {
  const m = month ?? monthStr, [y, mo] = m.split("-").map(Number), start = `${m}-01`, nxt = ymd(new Date(y, mo, 1));
  const pn = (pid: string | null) => S.pockets.find((p) => p.id === pid)?.name ?? "—", cn = (cid: string | null) => S.cats.find((c) => c.id === cid)?.name ?? "Uncategorised", tn = (hid: string | null) => S.holdings.find((h) => h.id === hid)?.ticker ?? "?";
  const es = S.entries.filter((e) => inMonth(e, m)).sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
  const journal = es.map((e) => {
    const a = e.amount_cents; let L: [string, number, number][];
    if (e.kind === "income") L = [[pn(e.to_pocket_id), a, 0], [`Income · ${cn(e.category_id)}`, 0, a]];
    else if (e.kind === "expense") L = [[`Expense · ${cn(e.category_id)}`, a, 0], [pn(e.from_pocket_id), 0, a]];
    else if (e.kind === "transfer") L = [[pn(e.to_pocket_id), a, 0], [pn(e.from_pocket_id), 0, a]];
    else if (e.kind === "contribution") L = [[`Investments · ${tn(e.holding_id)}`, a, 0], [e.from_pocket_id ? pn(e.from_pocket_id) : "Cash outside Orbit", 0, a]];
    else L = [[e.to_pocket_id ? pn(e.to_pocket_id) : `Investments · ${tn(e.holding_id)}`, a, 0], [`Dividend income · ${tn(e.holding_id)}`, 0, a]];
    return { entry_id: e.id, date: e.occurred_on, kind: e.kind, memo: e.note, lines: L.map(([account, dr_cents, cr_cents]) => ({ account, dr_cents, cr_cents })) };
  });
  const dr = journal.reduce((n, j) => n + j.lines.reduce((x, l) => x + l.dr_cents, 0), 0), cr = journal.reduce((n, j) => n + j.lines.reduce((x, l) => x + l.cr_cents, 0), 0);
  const open = balances(start), close = balances(nxt);
  const pockets: StatementPocket[] = S.pockets.filter((p) => !p.archived).map((p) => {
    const cl = S.closes.find((x) => x.month === m && x.pocket_id === p.id);
    return { pocket_id: p.id, name: p.name, role: p.role, opening_cents: open[p.id] ?? 0, in_cents: es.filter((e) => e.to_pocket_id === p.id).reduce((n, e) => n + e.amount_cents, 0),
      out_cents: es.filter((e) => e.from_pocket_id === p.id).reduce((n, e) => n + e.amount_cents, 0), closing_cents: close[p.id] ?? 0,
      close: cl ? { expected_cents: cl.expected_cents, actual_cents: cl.actual_cents, diff_cents: cl.diff_cents, destination_pocket_id: cl.destination_pocket_id, cap_cut_cents: cl.cap_cut_cents } : null };
  });
  const d = dashboard(), c = cfg(); let suggestion: Statement["suggestion"] = null;
  const byPurpose = (k: string) => S.pockets.find((p) => p.purpose === k && p.role === "savings");
  const behind = d.goals.find((g) => g.kind === "pocket" && (g.status === "behind" || g.status === "overdue") && g.pocket_id);
  if (d.invest_priority === "cash" && byPurpose(c.conditions.redirect_to)) suggestion = { pocket_id: byPurpose(c.conditions.redirect_to)!.id, name: byPurpose(c.conditions.redirect_to)!.name, reason: "Your liquid cash is under your buffer, so cash comes first." };
  else if (behind) suggestion = { pocket_id: behind.pocket_id!, name: pn(behind.pocket_id), reason: `Your “${behind.title}” goal is behind its pace.` };
  else if (byPurpose("general")) suggestion = { pocket_id: byPurpose("general")!.id, name: byPurpose("general")!.name, reason: "Nothing is urgent, so it goes to general savings." };
  const pending = S.closes.filter((x) => x.month === m).reduce((n, x) => n + x.cap_cut_cents, 0);
  return { month: m, currency: "SGD", journal, totals: { dr_cents: dr, cr_cents: cr, tallies: dr === cr }, pockets, suggestion,
    next_month_cap: { base_cents: c.spending_cap_cents, cut_cents: pending, effective_cents: Math.max(0, c.spending_cap_cents - pending) }, is_future: start > ymd(today) };
}
function ensureCat(name: string, kind: "income" | "expense") { let c = S.cats.find((x) => x.name === name); if (!c) { c = { id: id(), name, kind, counts_toward_cap: false, archived: false }; S.cats.push(c); } c.archived = false; return c; }
function settle(month: string, items: { pocket_id: string; actual_cents: number; destination_pocket_id?: string | null }[]) {
  const [y, mo] = month.split("-").map(Number), nxt = ymd(new Date(y, mo, 1)), when = ymd(new Date(Math.min(today.getTime(), new Date(y, mo, 0).getTime())));
  for (const it of items) {
    if (S.closes.some((x) => x.month === month && x.pocket_id === it.pocket_id)) throw new Error("That pocket is already reconciled for this month. Undo it first to redo.");
    const expected = balances(nxt)[it.pocket_id] ?? 0, diff = it.actual_cents - expected, ids: string[] = []; let cut = 0;
    const dest = it.destination_pocket_id && it.destination_pocket_id !== it.pocket_id ? it.destination_pocket_id : null;
    if (diff > 0) {
      const e: Entry = { id: id(), kind: "income", amount_cents: diff, occurred_on: when, note: "Reconciliation: cash not entered", category_id: ensureCat("Unrecorded cash", "income").id, from_pocket_id: null, to_pocket_id: it.pocket_id, holding_id: null, units: null, recurring: false };
      S.entries.push(e); ids.push(e.id);
      if (dest) { const t: Entry = { id: id(), kind: "transfer", amount_cents: diff, occurred_on: when, note: "Reconciliation: surplus moved", category_id: null, from_pocket_id: it.pocket_id, to_pocket_id: dest, holding_id: null, units: null, recurring: false }; S.entries.push(t); ids.push(t.id); }
    } else if (diff < 0) {
      const e: Entry = { id: id(), kind: "expense", amount_cents: -diff, occurred_on: when, note: "Reconciliation: spending not entered", category_id: ensureCat("Unrecorded spending", "expense").id, from_pocket_id: it.pocket_id, to_pocket_id: null, holding_id: null, units: null, recurring: false };
      S.entries.push(e); ids.push(e.id); cut = -diff;
    }
    S.closes.push({ month, pocket_id: it.pocket_id, expected_cents: expected, actual_cents: it.actual_cents, diff_cents: diff, destination_pocket_id: diff > 0 ? dest : null, cap_cut_cents: cut, entry_ids: ids });
  }
}
function undoSettle(month: string, pid: string) {
  const i = S.closes.findIndex((x) => x.month === month && x.pocket_id === pid); if (i < 0) return;
  const ids = new Set(S.closes[i].entry_ids); S.entries = S.entries.filter((e) => !ids.has(e.id)); S.closes.splice(i, 1);
}

function valuations(): Valuations {
  const pos = positions().filter((p) => !p.archived), months = [...new Set(S.vals.map((v) => v.month))].sort();
  const contribs = S.entries.filter((e) => e.kind === "contribution");
  const costAt = (hid: string, d: string) => (S.holdings.find((h) => h.id === hid)?.opening_cost_cents ?? 0) + contribs.filter((e) => e.holding_id === hid && e.occurred_on <= d).reduce((n, e) => n + e.amount_cents, 0);
  const history: ValuationRow[] = []; let prev: typeof S.vals | null = null, chain = 1, any = false;
  for (const m of months) {
    const cur = S.vals.filter((v) => v.month === m), value = cur.reduce((n, v) => n + v.value_cents, 0), cost = cur.reduce((n, v) => n + costAt(v.holding_id, v.recorded_on), 0);
    let mret: number | null = null;
    if (prev) {
      const both = cur.filter((v) => prev!.some((q) => q.holding_id === v.holding_id)), v0 = both.reduce((n, v) => n + prev!.find((q) => q.holding_id === v.holding_id)!.value_cents, 0), v1 = both.reduce((n, v) => n + v.value_cents, 0);
      const c = contribs.filter((e) => { const a = prev!.find((q) => q.holding_id === e.holding_id), b = both.find((q) => q.holding_id === e.holding_id); return a && b && e.occurred_on > a.recorded_on && e.occurred_on <= b.recorded_on; }).reduce((n, e) => n + e.amount_cents, 0);
      if (v0 + c / 2 > 0) { mret = (v1 - v0 - c) / (v0 + c / 2); chain *= 1 + mret; any = true; }
    }
    history.push({ month: m, recorded_on: cur.map((v) => v.recorded_on).sort().pop()!, value_cents: value, cost_cents: cost, gain_cents: value - cost, gain_pct: cost > 0 ? (value - cost) / cost : null, month_return: mret,
      by_holding: cur.map((v) => ({ ticker: S.holdings.find((h) => h.id === v.holding_id)!.ticker, value_cents: v.value_cents })) });
    prev = cur;
  }
  const tracked = pos.filter((p) => p.cost_cents > 0 || p.value_cents > 0 || p.units > 0), have = new Set(S.vals.filter((v) => v.month === monthStr).map((v) => v.holding_id));
  const due = tracked.length > 0 && today.getDate() >= S.valDay && tracked.some((p) => !have.has(p.id));
  const nextD = today.getDate() < S.valDay ? new Date(today.getFullYear(), today.getMonth(), S.valDay) : new Date(today.getFullYear(), today.getMonth() + 1, S.valDay);
  return { valuation_day: S.valDay, due, due_month: due ? monthStr : null,
    holdings: tracked.map((p) => ({ id: p.id, ticker: p.ticker, name: p.name, units: p.units, cost_cents: p.cost_cents, book_value_cents: p.value_cents, last_value_cents: [...S.vals].reverse().find((v) => v.holding_id === p.id)?.value_cents ?? null, recorded_this_month: have.has(p.id) })),
    history, latest: history[history.length - 1] ?? null, cumulative_return: any ? chain - 1 : null, next_check_in: ymd(nextD) };
}
function recordValuations(values: { holding_id: string; value_cents: number }[], month?: string) {
  const m = month ?? monthStr;
  for (const it of values) {
    const v = S.vals.find((x) => x.holding_id === it.holding_id && x.month === m);
    if (v) { v.value_cents = it.value_cents; v.recorded_on = ymd(today); } else S.vals.push({ holding_id: it.holding_id, month: m, value_cents: it.value_cents, recorded_on: ymd(today) });
    const p = positions().find((x) => x.id === it.holding_id), h = S.holdings.find((x) => x.id === it.holding_id)!;
    if (p && p.units > 0 && !p.units_missing) { h.price_cents = Math.round(it.value_cents / p.units); h.price_as_of = ymd(today); }
  }
}

const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 80));


// ── bank statement import (port of backend/app/services/fin_import.py) ──
const TRANSFERISH = /transfer|top.?up|paynow|fast\b|giro|own account|gxs|savings pocket|to savings|from savings/i;
const merchantKey = (d: string) => (d || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 1).slice(0, 3).join(" ");
const fpKeys = (rows: ImportLineIn[]) => { const seen: Record<string, number> = {}; return rows.map((r) => { const b = `${r.pocket_id}|${r.date}|${r.amount_cents}|${(r.description || "").trim().toLowerCase().replace(/\s+/g, " ")}`; const k = `${b}:${seen[b] ?? 0}`; seen[b] = (seen[b] ?? 0) + 1; return k; }); };
const dayGap = (a: string, b: string) => Math.abs((new Date(a + "T00:00").getTime() - new Date(b + "T00:00").getTime()) / 86400000);

function importPreview(rows: ImportLineIn[]): ImportPreview {
  const keys = fpKeys(rows), known = new Set(S.imp.map((x) => x.fp));
  const used = new Set(S.imp.filter((x) => x.entry_id).map((x) => `${x.entry_id}|${x.pocket_id}`));
  const out: ImportLine[] = rows.map((r, i) => ({ i, fp_key: keys[i], pocket_id: r.pocket_id, date: r.date, amount_cents: r.amount_cents, description: r.description, status: known.has(keys[i]) ? "imported" : "new",
    imported_as: null, entry_id: null, pair_with: null, category_id: null, hint: null }));
  for (const o of [...out].filter((x) => x.status === "new").sort((a, b) => a.date.localeCompare(b.date))) {
    let best: Entry | null = null, gap = 99;
    for (const e of S.entries) {
      if (e.amount_cents !== Math.abs(o.amount_cents) || used.has(`${e.id}|${o.pocket_id}`)) continue;
      if ((o.amount_cents < 0 ? e.from_pocket_id : e.to_pocket_id) !== o.pocket_id) continue;
      const g = dayGap(e.occurred_on, o.date); if (g <= 2 && g < gap) { best = e; gap = g; }
    }
    if (best) { used.add(`${best.id}|${o.pocket_id}`); o.status = "logged"; o.entry_id = best.id; }
  }
  const free = out.filter((x) => x.status === "new"), cands: [number, number, number, number][] = [];
  for (const a of free.filter((x) => x.amount_cents < 0)) for (const b of free.filter((x) => x.amount_cents > 0))
    if (a.pocket_id !== b.pocket_id && -a.amount_cents === b.amount_cents && dayGap(a.date, b.date) <= 3) cands.push([dayGap(a.date, b.date), TRANSFERISH.test(a.description) || TRANSFERISH.test(b.description) ? 0 : 1, a.i, b.i]);
  const taken = new Set<number>();
  for (const [, , ai, bi] of cands.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3])) {
    if (taken.has(ai) || taken.has(bi)) continue; taken.add(ai); taken.add(bi);
    Object.assign(out[ai], { status: "paired", pair_with: bi }); Object.assign(out[bi], { status: "paired", pair_with: ai });
  }
  for (const o of out) if (o.status === "new") { o.category_id = S.rulesImp[merchantKey(o.description)] ?? null; if (TRANSFERISH.test(o.description)) o.hint = "Looks like a transfer. If it went to another of your accounts, mark it as a move."; }
  const counts: ImportPreview["counts"] = {}; for (const o of out) counts[o.status] = (counts[o.status] ?? 0) + 1;
  return { rows: out, counts };
}

function importCommit(rows: ImportCommitRow[]): ImportResult {
  const keys = fpKeys(rows), known = new Set(S.imp.map((x) => x.fp)), counts = { booked: 0, transfers: 0, skipped: 0, linked: 0, already_imported: 0 };
  const newImp: typeof S.imp = [], newEntries: Entry[] = [], newRules: Record<string, string> = {};
  const mk = (kind: Entry["kind"], amt: number, d: string, o: Partial<Entry>): Entry => { const e: Entry = { id: id(), kind, amount_cents: amt, occurred_on: d, note: null, category_id: null, from_pocket_id: null, to_pocket_id: null, holding_id: null, units: null, recurring: false, ...o }; newEntries.push(e); return e; };
  const add = (r: ImportLineIn, k: string, e: string | null) => newImp.push({ fp: k, pocket_id: r.pocket_id, date: r.date, amt: r.amount_cents, desc: r.description, entry_id: e });
  const pairs: Record<string, number[]> = {}, done = new Set<number>();
  rows.forEach((r, i) => { if (known.has(keys[i])) counts.already_imported++; else if (r.action === "transfer" && r.pair_key) (pairs[r.pair_key] ??= []).push(i); });
  for (const idx of Object.values(pairs)) {
    if (idx.length !== 2) throw new Error("A paired transfer needs exactly two lines, one out of one account and one into another.");
    const [a, b] = [...idx].sort((x, y) => rows[x].amount_cents - rows[y].amount_cents), ra = rows[a], rb = rows[b];
    if (!(ra.amount_cents < 0 && rb.amount_cents > 0 && -ra.amount_cents === rb.amount_cents && ra.pocket_id !== rb.pocket_id)) throw new Error("Those two lines don't match up as a transfer (amounts must be equal, one out and one in, in different accounts).");
    const e = mk("transfer", rb.amount_cents, ra.date, { note: "Bank import: transfer between your accounts", from_pocket_id: ra.pocket_id, to_pocket_id: rb.pocket_id });
    add(ra, keys[a], e.id); add(rb, keys[b], e.id); counts.transfers++; done.add(a); done.add(b);
  }
  rows.forEach((r, i) => {
    if (known.has(keys[i]) || done.has(i)) return;
    const note = `Bank import: ${(r.description || "").trim().slice(0, 80)}`;
    if (r.action === "skip") { add(r, keys[i], null); counts.skipped++; }
    else if (r.action === "link") { if (!S.entries.some((e) => e.id === r.link_entry_id)) throw new Error("That line points at an entry that doesn't exist."); add(r, keys[i], r.link_entry_id ?? null); counts.linked++; }
    else if (r.action === "expense" || r.action === "income") {
      if ((r.amount_cents < 0) !== (r.action === "expense")) throw new Error(`“${r.description.slice(0, 40)}” is money ${r.amount_cents > 0 ? "in" : "out"}, so it can't be ${r.action === "expense" ? "an expense" : "income"}.`);
      const c = S.cats.find((x) => x.id === r.category_id);
      if (!c || c.kind !== r.action) throw new Error(`Pick a${r.action === "expense" ? "n expense" : "n income"} category for “${r.description.slice(0, 40)}”.`);
      const e = mk(r.action, Math.abs(r.amount_cents), r.date, { note, category_id: c.id, from_pocket_id: r.action === "expense" ? r.pocket_id : null, to_pocket_id: r.action === "income" ? r.pocket_id : null });
      add(r, keys[i], e.id); counts.booked++; const m = merchantKey(r.description); if (m) newRules[m] = c.id;
    } else if (r.action === "transfer") {
      if (!r.other_pocket_id || r.other_pocket_id === r.pocket_id) throw new Error(`Pick which of your other accounts “${r.description.slice(0, 40)}” went to or came from.`);
      const [f, t] = r.amount_cents < 0 ? [r.pocket_id, r.other_pocket_id] : [r.other_pocket_id, r.pocket_id];
      const e = mk("transfer", Math.abs(r.amount_cents), r.date, { note, from_pocket_id: f, to_pocket_id: t }); add(r, keys[i], e.id); counts.transfers++;
    } else throw new Error("Unknown action.");
  });
  S.entries.push(...newEntries); S.imp.push(...newImp); Object.assign(S.rulesImp, newRules);
  const last: Record<string, { d: string; bal: number }> = {};
  for (const r of rows) if (r.balance_cents != null && (!last[r.pocket_id] || r.date >= last[r.pocket_id].d)) last[r.pocket_id] = { d: r.date, bal: r.balance_cents };
  const nextDay = (d: string) => ymd(new Date(new Date(d + "T00:00").getTime() + 86400000));
  const checks = Object.entries(last).map(([pid, v]) => { const o = balances(nextDay(v.d))[pid] ?? 0; return { pocket_id: pid, name: S.pockets.find((p) => p.id === pid)!.name, as_of: v.d, bank_cents: v.bal, orbit_cents: o, diff_cents: v.bal - o }; });
  return { counts, balance_checks: checks };
}

function importSummary(): ImportSummaryRow[] {
  return S.pockets.filter((p) => !p.archived).map((p) => { const xs = S.imp.filter((x) => x.pocket_id === p.id).map((x) => x.date).sort(); return { pocket_id: p.id, name: p.name, lines: xs.length, first: xs[0] ?? null, last: xs[xs.length - 1] ?? null }; });
}

function reviewBase(week?: string): Omit<Review, "study_hours" | "focused_hours_by_kind" | "done" | "done_count"> {
  const w = weekSummary(week), nxt = ymd(new Date(new Date(w.week_start + "T00:00").getTime() + 7 * 86400000));
  const es = S.entries.filter((e) => e.occurred_on >= w.week_start && e.occurred_on < nxt);
  const change = es.reduce((n, e) => n + (e.kind === "income" || e.kind === "dividend" ? e.amount_cents : e.kind === "expense" ? -e.amount_cents : e.kind === "contribution" && e.from_pocket_id ? -e.amount_cents : 0), 0);
  const end = Object.values(balances(nxt)).reduce((a, b) => a + b, 0), t = ymd(new Date());
  return { ...w, is_current: w.week_start <= t && t < nxt, cash_change_cents: change, cash_end_cents: end, can_go_forward: nxt <= t,
    goals: dashboard().goals.map((g) => ({ title: g.title, progress: g.progress, status: g.status })) };
}
export const finDemoExtras = { reviewBase, entriesCsv: () => ["date,type,amount,currency,category,from_account,to_account,note", ...[...S.entries].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on)).map((e) => [e.occurred_on, e.kind, (e.amount_cents / 100).toFixed(2), "SGD", S.cats.find((c) => c.id === e.category_id)?.name ?? "", S.pockets.find((p) => p.id === e.from_pocket_id)?.name ?? "", S.pockets.find((p) => p.id === e.to_pocket_id)?.name ?? "", `"${(e.note ?? "").replace(/"/g, '""')}"`].join(","))].join("\n"),
  snapshot: () => ({ pockets: S.pockets, categories: S.cats, entries: S.entries, holdings: S.holdings, goals: S.goals, rules: S.rules, milestones: S.milestones, income_sources: S.sources, wishlist: WISHES }) };

export const finDemoApi: FinanceApi = {
  dashboard: (m) => wait(dashboard(m)),
  networth: async () => { const d = dashboard(); return wait({ snapshots: [...S.snapshots.map((s) => ({ month: s.month, net_worth_cents: s.nw, cash_cents: s.nw, investments_cents: 0 })), { month: monthStr, net_worth_cents: d.net_worth_cents, cash_cents: d.total_cash_cents, investments_cents: d.portfolio.total_cents }], milestones: S.milestones, birth_date: S.birth }); },
  async plan(r): Promise<PlanResult> {
    const d = dashboard(), c = cfg(), ct = S.cats.find((x) => x.id === r.category_id)!, pk2 = S.pockets.find((p) => p.id === r.pocket_id);
    const earmarked = pk2?.role === "earmarked", payLiquid = (pk2 ? pk2.is_liquid : true) && !earmarked, price = r.price_cents;
    const capLeft = d.cap_cents - d.spending_cents, after = d.liquid_cash_cents - (payLiquid ? price : 0);
    const flags: string[] = [], facts: string[] = []; let verdict: PlanResult["verdict"] = "fits";
    if (earmarked) facts.push("This is paid from a fund you've set aside for it, so it doesn't touch your monthly cap or everyday cash.");
    if (ct.counts_toward_cap) { if (price > capLeft) { verdict = "over_cap"; flags.push(`It would take you ${money(price - Math.max(capLeft, 0))} over your ${money(d.cap_cents)} monthly cap (${money(Math.max(capLeft, 0))} left this month).`); } else facts.push(`It fits inside your cap: ${money(capLeft - price)} would remain of ${money(c.spending_cap_cents)}.`); }
    if (payLiquid && after < c.liquidity_floor_cents) { verdict = "below_floor"; flags.push(`Paying from liquid cash would leave ${money(after)}, under your ${money(c.liquidity_floor_cents)} minimum buffer.`); } else if (payLiquid) facts.push(`Liquid cash after: ${money(after)} (buffer ${money(c.liquidity_floor_cents)}).`);
    const pct = !earmarked && d.income_cents > 0 ? price / d.income_cents : null;
    if (pct != null) facts.push(`That is ${(pct * 100).toFixed(1)}% of the income you've received this month (${money(d.income_cents)}).`);
    if (pk2) { const have = pk2.balance_cents; if (have < price) { verdict = "insufficient"; flags.push(`${pk2.name} only holds ${money(have)}, which is ${money(price - have)} short.`); } else facts.push(`${pk2.name} holds ${money(have)}; ${money(have - price)} would remain.`); }
    return wait({ verdict, flags, facts, cap_left_cents: capLeft, liquid_after_cents: after, pct_of_month_income: pct, name: r.name ?? null,
      suggestion: verdict !== "fits" && ct.counts_toward_cap ? "Next month's cap resets — buying then would keep this month within your own rule." : null,
      investing_note: d.invest_priority === "cash" ? "Liquid cash is already under your minimum buffer, so rebuilding cash comes before extra investing." : null,
      hourly_rate_cents: mainRateCents(), work_hours: mainRateCents() ? +(price / mainRateCents()!).toFixed(1) : null });
  },
  pockets: () => { const b = balances(); return wait(S.pockets.map((p) => ({ ...p, balance_cents: b[p.id] }))); },
  addPocket: async (p) => { S.pockets.push({ id: id(), ...p, provider: p.provider ?? null, balance_cents: 0, archived: false }); await wait(0); },
  patchPocket: async (pid, p) => { Object.assign(S.pockets.find((x) => x.id === pid)!, p); await wait(0); },
  categories: () => wait([...S.cats]),
  addCategory: async (c) => { S.cats.push({ id: id(), ...c, counts_toward_cap: c.kind === "expense" && c.counts_toward_cap, archived: false }); await wait(0); },
  patchCategory: async (cid, c) => { Object.assign(S.cats.find((x) => x.id === cid)!, c); await wait(0); },
  holdings: () => wait(positions()),
  addHolding: async (h) => { S.holdings.push({ id: id(), ticker: h.ticker.toUpperCase(), name: h.name ?? null, price_cents: null, price_as_of: null, opening_units: h.opening_units ?? 0, opening_cost_cents: h.opening_cost_cents ?? 0, shariah_note: h.shariah_note ?? null, archived: false }); await wait(0); },
  patchHolding: async (hid, h) => { const x = S.holdings.find((q) => q.id === hid)!; Object.assign(x, h); if (h.price_cents != null) x.price_as_of = ymd(new Date()); await wait(0); },
  entries: (m) => wait(S.entries.filter((e) => inMonth(e, m ?? monthStr)).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on))),
  async addEntry(e: NewEntry) { const row: Entry = { id: id(), kind: e.kind, amount_cents: e.amount_cents, occurred_on: e.occurred_on ?? ymd(new Date()), note: e.note ?? null, category_id: e.category_id ?? null, from_pocket_id: e.from_pocket_id ?? null, to_pocket_id: e.to_pocket_id ?? null, holding_id: e.holding_id ?? null, units: e.units ?? null, recurring: !!e.recurring }; S.entries.push(row); return wait(row); },
  async updateEntry(eid: string, e: NewEntry) { const row = S.entries.find((x) => x.id === eid)!; Object.assign(row, { kind: e.kind, amount_cents: e.amount_cents, occurred_on: e.occurred_on ?? row.occurred_on, note: e.note ?? null, category_id: e.category_id ?? null, from_pocket_id: e.from_pocket_id ?? null, to_pocket_id: e.to_pocket_id ?? null, holding_id: e.holding_id ?? null, units: e.units ?? null, recurring: !!e.recurring }); return wait({ ...row }); },
  async wishlist(): Promise<WishItem[]> { const out: WishItem[] = []; for (const w of WISHES) { const r = await finDemoApi.plan({ name: w.name, price_cents: w.price_cents, category_id: w.category_id }); out.push({ ...w, work_hours: mainRateCents() ? +(w.price_cents / mainRateCents()!).toFixed(1) : null, verdict: r.verdict, flags: r.flags }); } return out; },
  addWish: async (w) => { WISHES.push({ id: id(), name: w.name, price_cents: w.price_cents, category_id: w.category_id, note: w.note ?? null }); await wait(0); },
  removeWish: async (wid) => { const i = WISHES.findIndex((x) => x.id === wid); if (i >= 0) WISHES.splice(i, 1); await wait(0); },
  deleteEntry: async (eid) => { S.entries = S.entries.filter((e) => e.id !== eid); await wait(0); },
  addFinGoal: async (g) => { S.goals.push({ id: id(), title: g.title, kind: g.kind, pocket_id: g.pocket_id ?? null, target_cents: g.target_cents, target_date: g.target_date ?? null, planned_monthly_cents: g.planned_monthly_cents ?? null, manual: g.manual_current_cents ?? null, archived: false }); await wait(0); },
  patchFinGoal: async (gid, g) => { const x = S.goals.find((q) => q.id === gid)!; Object.assign(x, g); await wait(0); },
  rules: () => wait([...S.rules]),
  async saveRules(config) { const old = S.rules.find((r) => r.status === "current")!; old.status = "historical"; old.effective_to = ymd(new Date()); const row: RuleSet = { id: id(), name: "Current rules", status: "current", effective_from: ymd(new Date()), effective_to: null, note: null, config }; S.rules.unshift(row); return wait(row); },
  milestones: () => wait([...S.milestones].sort((a, b) => a.age - b.age)),
  putMilestone: async (m) => { const i = S.milestones.findIndex((x) => x.age === m.age); if (i >= 0) S.milestones[i] = m; else S.milestones.push(m); await wait(0); },
  deleteMilestone: async (age) => { S.milestones = S.milestones.filter((m) => m.age !== age); await wait(0); },
  scenarios: () => wait([...S.scenarios]),
  async addScenario(s) {
    const result = s.kind === "growth" ? { paths: (s.params.rates_pct as number[]).map((r) => ({ rate_pct: r, ...growth(Number(s.params.start_cents ?? 0), Number(s.params.monthly_cents), r, Number(s.params.years)) })) }
      : property(Number(s.params.price_cents), Number(s.params.down_pct), Number(s.params.loan_rate_pct), Number(s.params.tenure_years), dashboard().net_worth_cents, Number(s.params.monthly_save_cents ?? 0));
    const row: Scenario = { id: id(), name: s.name, kind: s.kind, params: s.params, result, created_at: new Date().toISOString() }; S.scenarios.push(row); return wait(row);
  },
  deleteScenario: async (sid) => { S.scenarios = S.scenarios.filter((x) => x.id !== sid); await wait(0); },
  incomeSources: () => wait([...S.sources]),
  saveIncomeSource: async (s) => { if (s.id) { const i = S.sources.findIndex((x) => x.id === s.id); S.sources[i] = s as IncomeSource; } else S.sources.push({ ...s, id: id() }); await wait(0); },
  deleteIncomeSource: async (sid) => { S.sources = S.sources.filter((x) => x.id !== sid); await wait(0); },
  finSettings: () => wait({ birth_date: S.birth, currency: "SGD", valuation_day: S.valDay, exam_focus_days: S.examDays }),
  setFinSettings: async (s) => { if ("birth_date" in s) S.birth = s.birth_date ?? null; if (s.valuation_day) S.valDay = s.valuation_day; if (s.exam_focus_days != null) S.examDays = s.exam_focus_days; return { birth_date: S.birth, currency: "SGD", valuation_day: S.valDay, exam_focus_days: S.examDays }; },
  weekSummary: (start) => wait(weekSummary(start)),
  statement: (m) => wait(statement(m)),
  settleStatement: async (m, items) => { settle(m, items); return wait(statement(m)); },
  undoSettle: async (m, pid) => { undoSettle(m, pid); return wait(statement(m)); },
  valuations: () => wait(valuations()),
  recordValuations: async (values, m) => { recordValuations(values, m); return wait(valuations()); },
  importPreview: (rows) => wait(importPreview(rows)),
  async importCommit(rows) { const r = importCommit(rows); return wait(r); },
  importSummary: () => wait(importSummary()),
  review: async () => { throw new Error("replaced in demo.ts"); },
};
