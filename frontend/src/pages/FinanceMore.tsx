import { useEffect, useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import { Button, Card, ErrorNote, Field, inputCls, NumInput } from "../components/ui";
import { usePrefs } from "../prefs";
import { WhatIf } from "../components/WhatIf";
import { TermsModal } from "../components/TermsModal";
import { ValuationModal } from "../components/ValuationModal";
import { money, pct } from "../lib";
import type { GoalView, MilestoneRow, Purpose, Role, RuleConfig } from "../types";
import { Bar, Chip, LineChart, PathsChart, toCents } from "./financeUi";

const pretty = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const dollars = (c: number | null | undefined) => (c == null ? "" : String(c / 100));
type P = { rev: number; bump: () => void };
const useRun = () => {
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => { setErr(null); try { await fn(); after?.(); } catch (e) { setErr((e as Error).message); } };
  return { err, setErr, run };
};

/* ───────── Funds (pockets & goals) ───────── */
export function Goals({ rev, bump }: P) {
  const pockets = useAsync(() => api.pockets(), [rev]);
  const dash = useAsync(() => api.dashboard(), [rev]);
  const { err, setErr, run } = useRun();
  const [np, setNp] = useState({ name: "", role: "savings" as Role, purpose: "general" as Purpose, provider: "", liquid: true, opening: "" });
  const [ng, setNg] = useState({ title: "", kind: "pocket" as GoalView["kind"], pocket: "", target: "", date: "", monthly: "", current: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState("");
  const live = (pockets.data ?? []).filter((p) => !p.archived);
  const total = live.reduce((n, p) => n + p.balance_cents, 0);

  return (
    <div className="space-y-5">
      <ErrorNote msg={err ?? pockets.error ?? dash.error} />
      <Card>
        <div className="mb-3 flex items-baseline justify-between"><h2 className="text-lg font-semibold">Cash pockets</h2><span className="num text-lg">{money(total)}</span></div>
        <ul className="divide-y divide-line">
          {live.map((p) => (
            <li key={p.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <div className="min-w-0 flex-1"><span>{p.name}</span><span className="ml-2 text-xs text-faint">{pretty(p.purpose)}{p.provider ? ` · ${p.provider}` : ""}{p.is_liquid ? " · liquid" : " · not liquid"}</span></div>
                <span className="num">{money(p.balance_cents)}</span>
                <button className="text-xs text-faint hover:text-ink" onClick={() => { setEditing(editing === p.id ? null : p.id); setOpen(dollars(p.opening_cents)); }}>edit</button>
              </div>
              {editing === p.id && (
                <div className="mt-2 flex flex-wrap items-end gap-3 rounded-xl bg-surface2 p-3">
                  <Field label="Opening balance (what was already there)"><input className={inputCls} type="number" min="0" step="0.01" value={open} onChange={(e) => setOpen(e.target.value)} /></Field>
                  <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={p.is_liquid} onChange={(e) => run(() => api.patchPocket(p.id, { is_liquid: e.target.checked }), bump)} /> Counts as liquid cash</label>
                  <Button onClick={() => run(() => api.patchPocket(p.id, { opening_cents: toCents(open) }), () => { setEditing(null); bump(); })}>Save</Button>
                  <Button variant="danger" onClick={() => run(() => api.patchPocket(p.id, { archived: true }), () => { setEditing(null); bump(); })}>Archive</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <form className="mt-4 grid gap-3 rounded-xl bg-surface2 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!np.name.trim()) return; run(() => api.addPocket({ name: np.name.trim(), role: np.role, purpose: np.purpose, provider: np.provider || null, is_liquid: np.liquid, opening_cents: toCents(np.opening) }), () => { setNp({ ...np, name: "", opening: "" }); bump(); }); }}>
          <Field label="New pocket"><input className={inputCls} value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} /></Field>
          <Field label="Where (optional)"><input className={inputCls} value={np.provider} onChange={(e) => setNp({ ...np, provider: e.target.value })} /></Field>
          <Field label="Kind"><select className={inputCls} value={np.purpose} onChange={(e) => { const purpose = e.target.value as Purpose; setNp({ ...np, purpose, role: purpose === "main" ? "spending" : purpose === "earmarked" ? "earmarked" : "savings", liquid: purpose !== "earmarked" }); }}>
            {(["main", "emergency", "travel", "general", "earmarked", "other"] as Purpose[]).map((x) => <option key={x} value={x}>{pretty(x)}</option>)}</select></Field>
          <Field label="Already in it"><input className={inputCls} type="number" min="0" step="0.01" value={np.opening} onChange={(e) => setNp({ ...np, opening: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={np.liquid} onChange={(e) => setNp({ ...np, liquid: e.target.checked })} /> Counts as liquid cash (money I could use quickly)</label>
          <div className="sm:col-span-2"><Button type="submit">Add pocket</Button></div>
        </form>
        <p className="mt-3 text-xs text-faint">Move money between pockets with “Move money” under Activity — transfers between savings pockets don't count as new savings.</p>
      </Card>

      {dash.data && <WhatIf goals={dash.data.goals} rateCents={dash.data.hourly_rate_cents} cur={dash.data.currency} />}

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Goals</h2>
        {dash.data?.goals.length === 0 && <p className="py-2 text-sm text-muted">No goals yet.</p>}
        <div className="space-y-5">{dash.data?.goals.map((g) => (
          <div key={g.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2"><span>{g.title}</span><span className="num text-sm text-muted">{money(g.current_cents)} of {money(g.target_cents)} · {pct(g.progress)}</span></div>
            <div className="mt-1.5"><Bar value={g.progress} /></div>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-faint">
              <span>{money(g.remaining_cents)} to go{g.target_date ? ` by ${new Date(g.target_date + "T00:00").toLocaleDateString([], { month: "short", year: "numeric" })}` : ""}
                {g.required_monthly_cents != null && g.status !== "achieved" ? ` · needs ${money(g.required_monthly_cents)}/mo` : ""}
                {g.planned_monthly_cents ? ` · planned ${money(g.planned_monthly_cents)}/mo` : ""}
                {g.actual_monthly_cents > 0 ? ` · recent pace ${money(g.actual_monthly_cents)}/mo` : ""}
                {g.eta_months != null && g.status !== "achieved" ? ` · about ${g.eta_months} months at that pace` : ""}</span>
              <span className="flex items-center gap-2"><Chip tone={g.status === "behind" || g.status === "overdue" ? "warn" : "pos"}>{{ achieved: "Reached", on_track: "On track", behind: "Behind pace", overdue: "Past its date", no_deadline: "No deadline" }[g.status]}</Chip>
                <button className="hover:text-neg" onClick={() => run(() => api.patchFinGoal(g.id, { archived: true }), bump)}>archive</button></span>
            </div>
          </div>))}</div>

        <form className="mt-5 grid gap-3 rounded-xl bg-surface2 p-4 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault(); const t = toCents(ng.target);
          if (!ng.title.trim() || !(t > 0)) return setErr("Give the goal a name and a target.");
          run(() => api.addFinGoal({ title: ng.title.trim(), kind: ng.kind, pocket_id: ng.kind === "pocket" ? ng.pocket || live[0]?.id : null, target_cents: t, target_date: ng.date || null, planned_monthly_cents: ng.monthly ? toCents(ng.monthly) : null, manual_current_cents: ng.kind === "custom" ? toCents(ng.current) : null }),
            () => { setNg({ ...ng, title: "", target: "", date: "", monthly: "", current: "" }); bump(); });
        }}>
          <Field label="New goal"><input className={inputCls} value={ng.title} onChange={(e) => setNg({ ...ng, title: e.target.value })} placeholder="Emergency cash to S$2,000" /></Field>
          <Field label="Tracks"><select className={inputCls} value={ng.kind} onChange={(e) => setNg({ ...ng, kind: e.target.value as GoalView["kind"] })}>
            <option value="pocket">A cash pocket</option><option value="investments">Total investments</option><option value="net_worth">Net worth</option><option value="custom">Something I update by hand</option></select></Field>
          {ng.kind === "pocket" && <Field label="Which pocket"><select className={inputCls} value={ng.pocket || live[0]?.id} onChange={(e) => setNg({ ...ng, pocket: e.target.value })}>{live.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
          {ng.kind === "custom" && <Field label="Current amount"><input className={inputCls} type="number" min="0" step="0.01" value={ng.current} onChange={(e) => setNg({ ...ng, current: e.target.value })} /></Field>}
          <Field label="Target"><input className={inputCls} type="number" min="0" step="0.01" value={ng.target} onChange={(e) => setNg({ ...ng, target: e.target.value })} /></Field>
          <Field label="Deadline (optional)"><input className={inputCls} type="date" value={ng.date} onChange={(e) => setNg({ ...ng, date: e.target.value })} /></Field>
          <Field label="Planned monthly contribution (optional)"><input className={inputCls} type="number" min="0" step="0.01" value={ng.monthly} onChange={(e) => setNg({ ...ng, monthly: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Button type="submit">Create goal</Button></div>
        </form>
      </Card>
    </div>
  );
}

/* ───────── Portfolio ───────── */
function suggestFor(rows: { ticker: string; target_pct: number; value_cents: number }[], total: number, amount: number) {
  const tg = rows.filter((r) => r.target_pct > 0);
  if (amount <= 0 || !tg.length) return [];
  const after = total + amount, short = tg.map((r) => Math.max(0, Math.round((after * r.target_pct) / 100) - r.value_cents)), need = short.reduce((a, b) => a + b, 0);
  const wsum = tg.reduce((n, r) => n + r.target_pct, 0);
  const alloc = tg.map((r, i) => (need >= amount ? Math.floor((amount * short[i]) / need) : short[i] + Math.floor(((amount - need) * r.target_pct) / wsum)));
  const left = amount - alloc.reduce((a, b) => a + b, 0);
  if (left) alloc[short.indexOf(Math.max(...short))] += left;
  return tg.map((r, i) => ({ ticker: r.ticker, amount_cents: alloc[i] })).filter((x) => x.amount_cents > 0).sort((a, b) => b.amount_cents - a.amount_cents);
}

export function Portfolio({ rev, bump }: P) {
  const dash = useAsync(() => api.dashboard(), [rev]);
  const holds = useAsync(() => api.holdings(), [rev]);
  const pockets = useAsync(() => api.pockets(), [rev]);
  const { err, run } = useRun();
  const val = useAsync(() => api.valuations(), [rev]);
  const [checkIn, setCheckIn] = useState(false);
  const [amount, setAmount] = useState<string | null>(null);
  const [price, setPrice] = useState<Record<string, string>>({});
  const [nh, setNh] = useState({ ticker: "", name: "", units: "", cost: "" });
  const [rec, setRec] = useState({ holding: "", amount: "", units: "", from: "" });
  if (!dash.data || !holds.data) return (dash.error ?? holds.error) ? <ErrorNote msg={dash.error ?? holds.error} /> : <p className="text-muted">Loading…</p>;
  const d = dash.data, cur = d.currency, pf = d.portfolio;
  const amt = amount === null ? pf.suggestion_amount_cents : toCents(amount);
  const sug = suggestFor(pf.rows, pf.total_cents, amt);
  const hid = (t: string) => holds.data!.find((h) => h.ticker === t);

  return (
    <div className="space-y-5">
      <ErrorNote msg={err} />
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">How it's going</h2>
          <Button variant="ghost" className="border border-line2" onClick={() => setCheckIn(true)}>{val.data?.due ? "Record this month's values" : "Update values"}</Button>
        </div>
        {val.data && val.data.history.length === 0 && <p className="text-sm text-muted">No check-ins yet. Record what your holdings are worth once a month and Orbit will track the gain or loss and the monthly return. It's for bookkeeping, not buy or sell signals.</p>}
        {val.data && val.data.latest && (() => {
          const L = val.data.latest, H = val.data.history, up = L.gain_cents >= 0;
          return (<div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div><p className="text-xs text-faint">Worth at last check-in</p><p className="num text-2xl">{money(L.value_cents, cur)}</p></div>
              <div><p className="text-xs text-faint">Paid in</p><p className="num text-2xl text-muted">{money(L.cost_cents, cur)}</p></div>
              <div><p className="text-xs text-faint">Gain / loss</p><p className={`num text-2xl ${up ? "text-pos" : "text-neg"}`}>{up ? "+" : "−"}{money(Math.abs(L.gain_cents), cur)} <span className="text-base">{pct(L.gain_pct, 1)}</span></p></div>
              <div><p className="text-xs text-faint">Last month's return</p><p className={`num text-2xl ${L.month_return == null ? "text-faint" : L.month_return >= 0 ? "text-pos" : "text-neg"}`}>{L.month_return == null ? "—" : `${L.month_return >= 0 ? "+" : ""}${pct(L.month_return, 1)}`}</p></div>
            </div>
            {H.length > 2 && <LineChart points={H.map((h) => ({ x: h.month, y: h.value_cents }))} />}
            <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm">
              <thead><tr className="text-left text-xs text-faint"><th className="py-1 font-normal">Month</th><th className="text-right font-normal">Worth</th><th className="text-right font-normal">Paid in</th><th className="text-right font-normal">Gain / loss</th><th className="text-right font-normal">Return that month</th></tr></thead>
              <tbody>{[...H].reverse().map((h) => (
                <tr key={h.month} className="border-t border-line">
                  <td className="py-1.5">{new Date(h.month + "-01T00:00").toLocaleDateString([], { month: "short", year: "numeric" })}</td>
                  <td className="num text-right">{money(h.value_cents, cur)}</td><td className="num text-right text-muted">{money(h.cost_cents, cur)}</td>
                  <td className={`num text-right ${h.gain_cents >= 0 ? "text-pos" : "text-neg"}`}>{h.gain_cents >= 0 ? "+" : "−"}{money(Math.abs(h.gain_cents), cur)} · {pct(h.gain_pct, 1)}</td>
                  <td className={`num text-right ${h.month_return == null ? "text-faint" : h.month_return >= 0 ? "text-pos" : "text-neg"}`}>{h.month_return == null ? "—" : `${h.month_return >= 0 ? "+" : ""}${pct(h.month_return, 1)}`}</td>
                </tr>))}</tbody>
            </table></div>
            {val.data.cumulative_return != null && <p className="text-xs text-muted">Chained monthly returns since you started checking in: {val.data.cumulative_return >= 0 ? "+" : ""}{pct(val.data.cumulative_return, 1)}. New money you added is taken out, so this reflects how the holdings did, not how much you put in. It's an approximation.</p>}
          </div>);
        })()}
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted">
          <label className="flex items-center gap-2">Ask me on day
            <select className="rounded-lg border border-line2 bg-surface2 px-2 py-1 text-ink" value={val.data?.valuation_day ?? 1} onChange={(e) => run(() => api.setFinSettings({ valuation_day: Number(e.target.value) }), () => { val.reload(); bump(); })}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}</select> of each month</label>
          {val.data && <span className="text-xs text-faint">Next check-in {new Date(val.data.next_check_in + "T00:00").toLocaleDateString([], { day: "numeric", month: "short" })}</span>}
        </div>
      </Card>
      {checkIn && <ValuationModal onClose={() => setCheckIn(false)} onDone={() => { val.reload(); bump(); }} />}

      <Card>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">Holdings</h2>
          <span className="num text-sm text-muted">Value {money(pf.total_cents, cur)} · cost {money(pf.cost_cents, cur)}{pf.pl_cents != null && <> · P/L <span className={pf.pl_cents >= 0 ? "text-pos" : "text-neg"}>{money(pf.pl_cents, cur)}</span></>}</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
          <thead><tr className="text-left text-xs text-faint"><th className="py-1 font-normal">Holding</th><th className="font-normal">Units</th><th className="font-normal">Price</th><th className="font-normal">Value</th><th className="font-normal">P/L</th><th className="font-normal">Now / target</th><th className="font-normal">Status</th></tr></thead>
          <tbody>{pf.rows.map((r) => {
            const h = hid(r.ticker);
            return (
              <tr key={r.ticker} className="border-t border-line align-top">
                <td className="py-2">{r.ticker}{h?.name && <div className="text-xs text-faint">{h.name}</div>}</td>
                <td className="num">{r.units ? +r.units.toFixed(4) : "—"}</td>
                <td className="num">{r.price_cents ? money(r.price_cents, cur) : <span className="text-faint">not set</span>}{r.price_as_of && <div className="text-[10px] text-faint">as of {r.price_as_of}</div>}
                  {h && <span className="mt-1 flex gap-1"><input className="w-20 rounded border border-line2 bg-surface2 px-1.5 py-0.5 text-xs" type="number" min="0" step="0.01" placeholder="price" value={price[h.id] ?? ""} onChange={(e) => setPrice({ ...price, [h.id]: e.target.value })} />
                    <button className="text-xs text-muted hover:text-ink" onClick={() => price[h.id] && run(() => api.patchHolding(h.id, { price_cents: toCents(price[h.id]) }), () => { setPrice({ ...price, [h.id]: "" }); bump(); })}>update</button></span>}</td>
                <td className="num">{money(r.value_cents, cur)}{!r.priced && r.value_cents > 0 && <div className="text-[10px] text-faint">at cost{r.units_missing ? " (units missing)" : ""}</div>}</td>
                <td className={`num ${r.pl_cents == null ? "text-faint" : r.pl_cents >= 0 ? "text-pos" : "text-neg"}`}>{r.pl_cents == null ? "—" : money(r.pl_cents, cur)}</td>
                <td className="num">{r.current_pct.toFixed(0)}% <span className="text-faint">/ {r.target_pct.toFixed(0)}%</span></td>
                <td><span className={r.status === "underweight" ? "text-sun" : r.status === "overweight" ? "text-muted" : "text-pos"}>{r.status === "at_target" ? "At target" : pretty(r.status)}</span></td>
              </tr>);
          })}</tbody>
        </table></div>
        <p className="mt-3 text-xs text-faint">Prices are entered by you, not pulled live — Orbit is for long-term allocation, not minute-to-minute moves. Targets live under Rules.</p>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-semibold">Where the next contribution should go</h2>
        {pf.suggestion_paused ? <p className="rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">{d.liquidity.message}</p> : (
          <p className="text-sm text-muted">Contribution-based rebalancing: new money goes to what's below target. Nothing is sold.</p>)}
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Contribution amount"><input className={inputCls + " max-w-40"} type="number" min="0" step="0.01" value={amount ?? dollars(pf.suggestion_amount_cents)} onChange={(e) => setAmount(e.target.value)} /></Field>
          <span className="pb-2 text-xs text-faint">defaults to your minimum — a floor, not a ceiling</span>
        </div>
        {!pf.suggestion_paused && (
          <ul className="mt-3 space-y-1.5 text-sm">{sug.map((s) => <li key={s.ticker} className="flex justify-between border-t border-line py-1.5"><span>{s.ticker}</span><span className="num">{money(s.amount_cents, cur)}</span></li>)}
            {sug.length === 0 && <li className="text-muted">Set portfolio targets under Rules to get a suggestion.</li>}</ul>)}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Record a contribution</h2>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const c = toCents(rec.amount); const hh = rec.holding || holds.data![0]?.id; if (!(c > 0) || !hh) return;
            run(() => api.addEntry({ kind: "contribution", amount_cents: c, holding_id: hh, units: rec.units ? Number(rec.units) : null, from_pocket_id: rec.from || null }), () => { setRec({ ...rec, amount: "", units: "" }); bump(); }); }}>
            <Field label="Holding"><select className={inputCls} value={rec.holding || holds.data[0]?.id} onChange={(e) => setRec({ ...rec, holding: e.target.value })}>{holds.data.filter((h) => !h.archived).map((h) => <option key={h.id} value={h.id}>{h.ticker}</option>)}</select></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Amount"><input className={inputCls} type="number" min="0" step="0.01" value={rec.amount} onChange={(e) => setRec({ ...rec, amount: e.target.value })} /></Field>
              <Field label="Units bought"><input className={inputCls} type="number" min="0" step="any" value={rec.units} onChange={(e) => setRec({ ...rec, units: e.target.value })} /></Field></div>
            <Field label="Paid from"><select className={inputCls} value={rec.from} onChange={(e) => setRec({ ...rec, from: e.target.value })}><option value="">Outside my tracked cash</option>{(pockets.data ?? []).filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Button type="submit">Record</Button>
          </form>
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Add a holding</h2>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!nh.ticker.trim()) return; run(() => api.addHolding({ ticker: nh.ticker, name: nh.name || null, opening_units: nh.units ? Number(nh.units) : 0, opening_cost_cents: toCents(nh.cost) }), () => { setNh({ ticker: "", name: "", units: "", cost: "" }); bump(); }); }}>
            <div className="grid grid-cols-2 gap-3"><Field label="Ticker"><input className={inputCls} value={nh.ticker} onChange={(e) => setNh({ ...nh, ticker: e.target.value })} placeholder="DBS" /></Field><Field label="Name (optional)"><input className={inputCls} value={nh.name} onChange={(e) => setNh({ ...nh, name: e.target.value })} /></Field></div>
            <div className="grid grid-cols-2 gap-3"><Field label="Units you already own"><input className={inputCls} type="number" min="0" step="any" value={nh.units} onChange={(e) => setNh({ ...nh, units: e.target.value })} /></Field><Field label="What you paid in total"><input className={inputCls} type="number" min="0" step="0.01" value={nh.cost} onChange={(e) => setNh({ ...nh, cost: e.target.value })} /></Field></div>
            <Button type="submit">Add holding</Button>
          </form>
        </Card>
      </div>

    </div>
  );
}

/* ───────── Income ───────── */
export function Income({ rev, bump }: P) {
  const { on } = usePrefs();
  const dash = useAsync(() => api.dashboard(), [rev]);
  const jobs = useAsync(() => api.jobs(), [rev]);
  const sources = useAsync(() => api.incomeSources(), [rev]);
  const { err, run } = useRun();
  const [terms, setTerms] = useState(false);
  const [nj, setNj] = useState({ name: "", basis: "hourly" as "hourly" | "monthly", rate: "", brk: "0", after: "480" });
  const [ns, setNs] = useState({ name: "", kind: "allowance", amount: "", term: true, brk: false });
  const ex = dash.data?.expected_income;

  return (
    <div className="space-y-5">
      <ErrorNote msg={err ?? jobs.error ?? sources.error} />
      {ex && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Expected this month</h2>
          <ul className="space-y-1.5 text-sm">
            {ex.items.map((i) => <li key={i.name} className="flex justify-between"><span>{i.name}{i.note && <span className="ml-2 text-xs text-faint">{i.note}</span>}</span><span className="num">{money(i.cents)}</span></li>)}
            <li className="flex justify-between"><span>Work shifts <span className="text-xs text-faint">{ex.work.scheduled_hours}h scheduled · {ex.work.completed_hours}h done</span></span><span className="num">{money(ex.work.expected_hourly_pay_cents + ex.work.monthly_pay_cents)}</span></li>
            <li className="flex justify-between border-t border-line pt-2"><span>Total expected</span><span className="num text-lg">{money(ex.total_cents)}</span></li>
          </ul>
          <p className="mt-3 text-xs text-faint">Orbit never assumes a fixed salary: allocations use income you've actually received. This is just a preview from your shifts and allowance. <button className="underline" onClick={() => setTerms(true)}>Edit calendar periods</button> to control when each income source applies.</p>
        </Card>
      )}

      {on("work") && (      <Card>
        <h2 className="mb-3 text-lg font-semibold">Jobs</h2>
        <ul className="divide-y divide-line">{(jobs.data ?? []).map((j) => (
          <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <div><div>{j.name}{j.is_main && <span className="ml-2 rounded-full border border-line2 px-2 py-0.5 text-[11px] text-muted">Main job</span>}</div><div className="text-xs text-faint">{j.pay_basis === "hourly" ? `${money(Math.round((j.hourly_rate ?? 0) * 100))}/hour` : `${money(Math.round((j.monthly_pay ?? 0) * 100))}/month`}{j.unpaid_break_minutes > 0 ? ` · ${j.unpaid_break_minutes} min unpaid break on shifts of ${j.break_after_minutes / 60}h or more` : ""}</div></div>
            <span className="flex gap-3">{!j.is_main && <button className="text-faint hover:text-ink" onClick={() => run(() => api.setMainJob(j.id), bump)}>Make main</button>}<button className="text-faint hover:text-neg" onClick={() => run(() => api.deleteJob(j.id), bump)}>Remove</button></span>
          </li>))}
          {jobs.data?.length === 0 && <li className="py-2 text-sm text-muted">No jobs yet.</li>}</ul>
        <form className="mt-4 grid gap-3 rounded-xl bg-surface2 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const v = parseFloat(nj.rate || "0"); if (!nj.name.trim()) return;
          run(() => api.addJob({ name: nj.name.trim(), pay_basis: nj.basis, hourly_rate: nj.basis === "hourly" ? v : null, monthly_pay: nj.basis === "monthly" ? v : null, unpaid_break_minutes: Number(nj.brk) || 0, break_after_minutes: Number(nj.after) || 0 }), () => { setNj({ ...nj, name: "", rate: "" }); bump(); }); }}>
          <Field label="Job"><input className={inputCls} value={nj.name} onChange={(e) => setNj({ ...nj, name: e.target.value })} placeholder="Part-time (F&B)" /></Field>
          <Field label="Paid"><select className={inputCls} value={nj.basis} onChange={(e) => setNj({ ...nj, basis: e.target.value as "hourly" | "monthly" })}><option value="hourly">Per hour</option><option value="monthly">Per month</option></select></Field>
          <Field label={nj.basis === "hourly" ? "Hourly rate (S$)" : "Monthly pay (S$)"}><input className={inputCls} type="number" min="0" step="0.01" value={nj.rate} onChange={(e) => setNj({ ...nj, rate: e.target.value })} /></Field>
          <Field label="Unpaid break (minutes)"><input className={inputCls} type="number" min="0" value={nj.brk} onChange={(e) => setNj({ ...nj, brk: e.target.value })} /></Field>
          <Field label="…taken on shifts of at least (minutes)"><input className={inputCls} type="number" min="0" value={nj.after} onChange={(e) => setNj({ ...nj, after: e.target.value })} /></Field>
          <div className="self-end"><Button type="submit">Add job</Button></div>
        </form>
        <p className="mt-3 text-xs text-faint">Your main job sets "your hourly rate" everywhere, such as the cost of a purchase in hours and the What if sliders. When you create a fixed commitment under a Work planet you can link it to a job, and Orbit works out expected pay from the hours (minus unpaid breaks).</p>
      </Card>)}

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Other income</h2>
        <ul className="divide-y divide-line">{(sources.data ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <div><div>{s.name} <span className="text-xs text-faint">{pretty(s.kind)}</span></div><div className="text-xs text-faint">{money(s.monthly_cents)}/month · {s.pays_in_term ? "paid in busy periods" : "not in busy periods"} · {s.pays_in_break ? "paid in time off" : "none in time off"}</div></div>
            <button className="text-faint hover:text-neg" onClick={() => run(() => api.deleteIncomeSource(s.id), bump)}>Remove</button>
          </li>))}</ul>
        <form className="mt-4 grid gap-3 rounded-xl bg-surface2 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!ns.name.trim()) return; run(() => api.saveIncomeSource({ name: ns.name.trim(), kind: ns.kind, monthly_cents: toCents(ns.amount), pays_in_term: ns.term, pays_in_break: ns.brk, active: true }), () => { setNs({ ...ns, name: "", amount: "" }); bump(); }); }}>
          <Field label="Name"><input className={inputCls} value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} placeholder="Allowance, internship stipend…" /></Field>
          <Field label="Type"><select className={inputCls} value={ns.kind} onChange={(e) => setNs({ ...ns, kind: e.target.value })}>{["allowance", "internship", "full_time", "freelance", "part_time", "other"].map((k) => <option key={k} value={k}>{pretty(k)}</option>)}</select></Field>
          <Field label="Per month (S$)"><input className={inputCls} type="number" min="0" step="0.01" value={ns.amount} onChange={(e) => setNs({ ...ns, amount: e.target.value })} /></Field>
          <div className="space-y-1 self-end text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={ns.term} onChange={(e) => setNs({ ...ns, term: e.target.checked })} /> Paid in busy periods</label><label className="flex items-center gap-2"><input type="checkbox" checked={ns.brk} onChange={(e) => setNs({ ...ns, brk: e.target.checked })} /> Paid in time off</label></div>
          <div className="sm:col-span-2"><Button type="submit">Add</Button></div>
        </form>
      </Card>
      {terms && <TermsModal onClose={() => setTerms(false)} onDone={bump} />}
    </div>
  );
}

/* ───────── Rules ───────── */
export function Rules({ rev, bump }: P) {
  const { on } = usePrefs();
  const rules = useAsync(() => api.rules(), [rev]);
  const settings = useAsync(() => api.finSettings(), [rev]);
  const { err, setErr, run } = useRun();
  const current = rules.data?.find((r) => r.status === "current");
  const [cfg, setCfg] = useState<RuleConfig | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (current) setCfg(structuredClone(current.config)); }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cfg || !current) return rules.error ? <ErrorNote msg={rules.error} /> : <p className="text-muted">Loading…</p>;
  const up = (patch: Partial<RuleConfig>) => { setSaved(false); setCfg({ ...cfg, ...patch }); };
  const allocTotal = cfg.allocation.reduce((n, a) => n + a.pct, 0), portTotal = cfg.portfolio.reduce((n, p) => n + p.pct, 0);
  const money$ = (label: string, v: number | null, set: (c: number) => void, hint?: string) => (
    <Field label={label}><NumInput min={0} step={1} scale={100} value={v} onChange={set} />{hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}</Field>);
  const save = () => {
    if (on("investing") && portTotal > 0 && Math.abs(portTotal - 100) > 0.01) return setErr("Portfolio targets must add up to 100%.");
    if (allocTotal > 100.01) return setErr("Allocation can't exceed 100%.");
    run(() => api.saveRules(cfg), () => { setSaved(true); bump(); });
  };

  return (
    <div className="space-y-5">
      <ErrorNote msg={err ?? rules.error} />
      <Card>
        <h2 className="mb-1 text-lg font-semibold">Current rules</h2>
        <p className="mb-4 text-sm text-muted">Everything Orbit tells you comes from these numbers. Saving creates a new version; the previous one is kept as history.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {money$("Monthly spending cap (S$)", cfg.spending_cap_cents, (c) => up({ spending_cap_cents: c }), "A ceiling, not a target.")}
          {money$("Minimum liquid cash buffer (S$)", cfg.liquidity_floor_cents, (c) => up({ liquidity_floor_cents: c }), "Below this, cash is rebuilt before extra investing.")}
          {money$("Comfortable cash level (S$)", cfg.liquidity_comfort_cents, (c) => up({ liquidity_comfort_cents: c }), "Optional upper end of your buffer range.")}
          {money$("Minimum investment contribution (S$/month)", cfg.min_contribution_cents, (c) => up({ min_contribution_cents: c }), "A floor — not a maximum.")}
          {money$("Save + invest target, low (S$/month)", cfg.save_invest_target.low_cents, (c) => up({ save_invest_target: { ...cfg.save_invest_target, low_cents: c } }))}
          {money$("Save + invest target, high (S$/month)", cfg.save_invest_target.high_cents, (c) => up({ save_invest_target: { ...cfg.save_invest_target, high_cents: c } }))}
          <Field label="Allowed portfolio drift (percentage points)"><NumInput min={0} max={50} value={cfg.tolerance_pp} onChange={(n) => up({ tolerance_pp: n })} /></Field>
          <Field label="Date of birth (for age milestones)"><input className={inputCls} type="date" value={settings.data?.birth_date ?? ""} onChange={(e) => run(() => api.setFinSettings({ birth_date: e.target.value || null }), () => { settings.reload(); bump(); })} /></Field>
          {on("study") && <Field label="Quiet money reminders before an exam (days)"><select className={inputCls} value={settings.data?.exam_focus_days ?? 7} onChange={(e) => run(() => api.setFinSettings({ exam_focus_days: Number(e.target.value) }), () => { settings.reload(); bump(); })}>
            <option value={0}>Never, keep everything on</option>{[3, 5, 7, 10, 14].map((n) => <option key={n} value={n}>{n} days before</option>)}</select><span className="mt-1 block text-xs text-faint">Mark a study commitment as an exam and Orbit hides the small stuff until it's over.</span></Field>}
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">How income is allocated</h2>
          <span className={`text-sm ${Math.abs(allocTotal - 100) < 0.01 ? "text-pos" : allocTotal === 0 ? "text-faint" : "text-warn"}`}>{allocTotal}% of 100%</span></div>
        <p className="mb-3 text-sm text-muted">Orbit doesn't assume a split. Set what share of the income you actually receive each line should get.</p>
        <div className="space-y-2.5">{cfg.allocation.map((a, i) => (
          <div key={a.key} className="flex items-center gap-3 text-sm"><span className="flex-1">{a.label}</span>
            <NumInput className={inputCls + " max-w-24"} min={0} max={100} step={1} value={a.pct} onChange={(n) => { const al = [...cfg.allocation]; al[i] = { ...a, pct: n }; up({ allocation: al }); }} /><span className="text-faint">%</span></div>))}</div>
      </Card>

      {on("investing") && (      <Card>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">Portfolio targets</h2><span className={`text-sm ${Math.abs(portTotal - 100) < 0.01 ? "text-pos" : "text-warn"}`}>{portTotal}% of 100%</span></div>
        <div className="space-y-2.5">{cfg.portfolio.map((p, i) => (
          <div key={i} className="flex items-center gap-3 text-sm"><input className={inputCls + " max-w-32"} value={p.ticker} onChange={(e) => { const pf = [...cfg.portfolio]; pf[i] = { ...p, ticker: e.target.value.toUpperCase() }; up({ portfolio: pf }); }} />
            <NumInput className={inputCls + " max-w-24"} min={0} max={100} value={p.pct} onChange={(n) => { const pf = [...cfg.portfolio]; pf[i] = { ...p, pct: n }; up({ portfolio: pf }); }} /><span className="text-faint">%</span>
            <button className="text-faint hover:text-neg" onClick={() => up({ portfolio: cfg.portfolio.filter((_, j) => j !== i) })}>Remove</button></div>))}
          <Button variant="ghost" className="border border-line2" onClick={() => up({ portfolio: [...cfg.portfolio, { ticker: "", pct: 0 }] })}>+ Add a stock or fund</Button></div>
      </Card>)}

      <Card>
        <h2 className="mb-3 text-lg font-semibold">If-then rules</h2>
        <div className="space-y-2.5 text-sm">
          {([["liquidity_first", "If liquid cash is below my buffer, rebuild cash before investing (the investing share goes to the line below)."], ["cap_warning", "If spending goes above my cap, warn me."], ["underweight_first", "Direct new contributions to holdings below target."]] as const).map(([k, l]) => (
            <label key={k} className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={cfg.conditions[k]} onChange={(e) => up({ conditions: { ...cfg.conditions, [k]: e.target.checked } })} /> {l}</label>))}
          <Field label="Cash-first redirect goes to"><select className={inputCls + " max-w-64"} value={cfg.conditions.redirect_to} onChange={(e) => up({ conditions: { ...cfg.conditions, redirect_to: e.target.value } })}>{cfg.allocation.filter((a) => a.source === "pocket").map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select></Field>
        </div>
      </Card>

      <div className="flex items-center gap-3"><Button onClick={save}>Save as my current rules</Button>{saved && <span className="text-sm text-pos">Saved — the previous version is in history.</span>}</div>
    </div>
  );
}

/* ───────── Roadmap: milestones + scenarios ───────── */
export function Roadmap({ rev, bump }: P) {
  const ms = useAsync(() => api.milestones(), [rev]);
  const dash = useAsync(() => api.dashboard(), [rev]);
  const hist = useAsync(() => api.networth(), [rev]);
  const scn = useAsync(() => api.scenarios(), [rev]);
  const { err, run } = useRun();
  const [nm, setNm] = useState({ age: "", low: "", high: "" });
  const [g, setG] = useState({ name: "Steady investing", start: "", monthly: "300", years: "10", rates: "3, 6" });
  const [pr, setPr] = useState({ name: "Cluster home", price: "", down: "25", rate: "3", years: "25", save: "" });
  const m = dash.data?.milestone;

  return (
    <div className="space-y-5">
      <ErrorNote msg={err ?? ms.error ?? scn.error} />
      <Card>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">Net-worth roadmap</h2>
          {m && <Chip tone={m.status === "behind" ? "warn" : "pos"}>{m.status === "ahead" ? "Ahead" : m.status === "on_track" ? "On track" : "Behind your roadmap"} · age {m.age}</Chip>}</div>
        {hist.data && <LineChart points={hist.data.snapshots.map((s) => ({ x: s.month, y: s.net_worth_cents }))} />}
        <p className="mb-3 mt-2 text-xs text-faint">Checkpoints are your own targets, not guaranteed outcomes. Missing one is information, not failure.</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-sm">
          <thead><tr className="text-left text-xs text-faint"><th className="py-1 font-normal">Age</th><th className="font-normal">Net worth from</th><th className="font-normal">to</th><th /></tr></thead>
          <tbody>{(ms.data ?? []).map((r: MilestoneRow) => (
            <tr key={r.age} className={`border-t border-line ${m?.checkpoint.age === r.age ? "bg-surface2/60" : ""}`}><td className="py-2">{r.age}{m?.checkpoint.age === r.age && <span className="ml-2 text-xs text-sun">current checkpoint</span>}</td>
              <td className="num">{money(r.nw_low_cents)}</td><td className="num">{r.nw_high_cents ? money(r.nw_high_cents) : "—"}</td>
              <td className="text-right"><button className="text-faint hover:text-neg" onClick={() => run(() => api.deleteMilestone(r.age), bump)}>✕</button></td></tr>))}</tbody>
        </table></div>
        <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const age = parseInt(nm.age); if (!age || !nm.low) return; run(() => api.putMilestone({ age, nw_low_cents: toCents(nm.low), nw_high_cents: nm.high ? toCents(nm.high) : null, note: null }), () => { setNm({ age: "", low: "", high: "" }); bump(); }); }}>
          <Field label="Age"><input className={inputCls + " max-w-24"} type="number" value={nm.age} onChange={(e) => setNm({ ...nm, age: e.target.value })} /></Field>
          <Field label="From (S$)"><input className={inputCls + " max-w-36"} type="number" value={nm.low} onChange={(e) => setNm({ ...nm, low: e.target.value })} /></Field>
          <Field label="To (optional)"><input className={inputCls + " max-w-36"} type="number" value={nm.high} onChange={(e) => setNm({ ...nm, high: e.target.value })} /></Field>
          <Button type="submit">Add / update</Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-semibold">Scenarios</h2>
        <p className="mb-4 text-sm text-muted">What-ifs built on assumptions you choose. They are not forecasts, and returns, rates and property prices are outside your control.</p>
        <div className="space-y-5">{(scn.data ?? []).map((s) => (
          <div key={s.id} className="rounded-xl border border-line p-4">
            <div className="mb-2 flex items-baseline justify-between"><span className="font-medium">{s.name} <span className="text-xs text-faint">{s.kind === "growth" ? "investment growth" : "property"}</span></span><button className="text-xs text-faint hover:text-neg" onClick={() => run(() => api.deleteScenario(s.id), bump)}>delete</button></div>
            {s.kind === "growth" && s.result.paths ? <>
              <PathsChart paths={s.result.paths} />
              <ul className="mt-2 space-y-1 text-sm text-muted">{s.result.paths.map((p) => <li key={p.rate_pct}>If returns averaged {p.rate_pct}%/yr: {money(p.final_cents)} after {s.params.years} years ({money(p.contributed_cents)} contributed, {money(p.growth_cents)} growth)</li>)}</ul></>
              : <ul className="space-y-1 text-sm text-muted">
                <li>Down payment: <span className="num text-ink">{money(Number(s.result.down_payment_cents))}</span> · loan {money(Number(s.result.loan_cents))}</li>
                <li>Monthly repayment at {String(s.params.loan_rate_pct)}% over {String(s.params.tenure_years)} years: <span className="num text-ink">{money(Number(s.result.monthly_payment_cents))}</span></li>
                <li>Gap to the down payment from what you hold today: {money(Number(s.result.gap_to_down_cents))}{s.result.months_to_down != null ? ` — about ${String(s.result.months_to_down)} months at your chosen monthly saving` : ""}</li></ul>}
            <p className="mt-2 text-xs text-faint">{String((s.result.paths?.[0]?.label ?? s.result.label) ?? "Assumption")}</p>
          </div>))}</div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <form className="space-y-3 rounded-xl bg-surface2 p-4" onSubmit={(e) => { e.preventDefault(); const rates = g.rates.split(",").map((x) => parseFloat(x)).filter((x) => !isNaN(x)).slice(0, 4);
            run(() => api.addScenario({ name: g.name || "Growth", kind: "growth", params: { start_cents: toCents(g.start), monthly_cents: toCents(g.monthly), years: Number(g.years), rates_pct: rates.length ? rates : [5] } }), bump); }}>
            <h3 className="font-medium">Investment growth</h3>
            <Field label="Name"><input className={inputCls} value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Starting amount (S$)"><input className={inputCls} type="number" value={g.start} onChange={(e) => setG({ ...g, start: e.target.value })} /></Field><Field label="Per month (S$)"><input className={inputCls} type="number" value={g.monthly} onChange={(e) => setG({ ...g, monthly: e.target.value })} /></Field></div>
            <div className="grid grid-cols-2 gap-3"><Field label="Years"><input className={inputCls} type="number" min="1" max="60" value={g.years} onChange={(e) => setG({ ...g, years: e.target.value })} /></Field><Field label="Assumed returns %/yr (up to 4)"><input className={inputCls} value={g.rates} onChange={(e) => setG({ ...g, rates: e.target.value })} /></Field></div>
            <Button type="submit">Run scenario</Button>
          </form>
          <form className="space-y-3 rounded-xl bg-surface2 p-4" onSubmit={(e) => { e.preventDefault(); if (!pr.price) return;
            run(() => api.addScenario({ name: pr.name || "Property", kind: "property", params: { price_cents: toCents(pr.price), down_pct: Number(pr.down), loan_rate_pct: Number(pr.rate), tenure_years: Number(pr.years), monthly_save_cents: toCents(pr.save) } }), bump); }}>
            <h3 className="font-medium">Property affordability</h3>
            <Field label="Name"><input className={inputCls} value={pr.name} onChange={(e) => setPr({ ...pr, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Price (S$)"><input className={inputCls} type="number" value={pr.price} onChange={(e) => setPr({ ...pr, price: e.target.value })} /></Field><Field label="Down payment %"><input className={inputCls} type="number" value={pr.down} onChange={(e) => setPr({ ...pr, down: e.target.value })} /></Field></div>
            <div className="grid grid-cols-3 gap-3"><Field label="Loan rate %"><input className={inputCls} type="number" step="0.1" value={pr.rate} onChange={(e) => setPr({ ...pr, rate: e.target.value })} /></Field><Field label="Years"><input className={inputCls} type="number" value={pr.years} onChange={(e) => setPr({ ...pr, years: e.target.value })} /></Field><Field label="Save/mo (S$)"><input className={inputCls} type="number" value={pr.save} onChange={(e) => setPr({ ...pr, save: e.target.value })} /></Field></div>
            <Button type="submit">Run scenario</Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
