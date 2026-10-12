import { useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import { Button, Card, ErrorNote, Field, inputCls } from "../components/ui";
import { money, pct } from "../lib";
import type { Dashboard, Entry, EntryKind, GoalView, NewEntry, PlanResult } from "../types";
import { Statement } from "./FinanceStatement";
import { ImportStatements } from "./FinanceImport";
import { useFocus } from "../focus";
import { usePrefs } from "../prefs";
import { where } from "../lib";
import { Goals, Income, Portfolio, Roadmap, Rules } from "./FinanceMore";
import { Bar, Chip, LineChart, Stat, monthKey, monthName, shiftMonth, toCents } from "./financeUi";

type Sub = "overview" | "planning" | "activity" | "pockets" | "portfolio" | "income" | "rules" | "roadmap";
const SUBS: [Sub, string][] = [["overview", "Overview"], ["planning", "Planning"], ["activity", "Activity"], ["pockets", "Funds"], ["portfolio", "Portfolio"], ["income", "Income"], ["rules", "Rules"], ["roadmap", "Roadmap"]];

export default function Finance({ rev, bump }: { rev: number; bump: () => void }) {
  const [sub, setSub] = useState<Sub>("overview");
  const { on } = usePrefs();
  const gate: Partial<Record<Sub, boolean>> = { planning: on("planning"), portfolio: on("investing"), roadmap: on("investing") };
  const subs = SUBS.filter(([k]) => gate[k] !== false);
  const cur = gate[sub] === false ? "overview" : sub;
  where.sub = SUBS.find(([k]) => k === cur)?.[1] ?? "";
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="text-sm text-muted">Earn, budget, protect liquidity, save, invest, track — by your own rules.</p>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {subs.map(([k, l]) => (
          <button key={k} onClick={() => setSub(k)}
            className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm ${cur === k ? "border-ink bg-ink text-bg" : "border-line2 text-muted hover:text-ink"}`}>{l}</button>
        ))}
      </div>
      {cur === "overview" && <Overview rev={rev} go={setSub} />}
      {cur === "planning" && <Planning rev={rev} />}
      {cur === "activity" && <Activity rev={rev} bump={bump} />}
      {cur === "pockets" && <Goals rev={rev} bump={bump} />}
      {cur === "portfolio" && <Portfolio rev={rev} bump={bump} />}
      {cur === "income" && <Income rev={rev} bump={bump} />}
      {cur === "rules" && <Rules rev={rev} bump={bump} />}
      {cur === "roadmap" && <Roadmap rev={rev} bump={bump} />}
    </div>
  );
}

/* ───────── Overview ───────── */
const PURPOSE_LABEL: Record<string, string> = { main: "Everyday", emergency: "Emergency", travel: "Travel", general: "General", earmarked: "Set aside", other: "Other goals" };
const STATUS_TXT: Record<GoalView["status"], string> = { achieved: "Reached", on_track: "On track", behind: "Behind pace", overdue: "Past its date", no_deadline: "No deadline" };

function Overview({ rev, go }: { rev: number; go: (s: Sub) => void }) {
  const { on } = usePrefs();
  const [month, setMonth] = useState(monthKey(new Date()));
  const dash = useAsync(() => api.dashboard(month), [rev, month]);
  const focus = useFocus();
  const quiet = !!focus?.active;
  const hist = useAsync(() => api.networth(), [rev]);
  if (dash.error) return <ErrorNote msg={dash.error} />;
  if (!dash.data) return <p className="text-muted">Loading…</p>;
  const d: Dashboard = dash.data, cur = d.currency;
  const spendTone = d.cap_used != null && d.cap_used > 1 ? "neg" : d.cap_used != null && d.cap_used > 0.85 ? "warn" : undefined;
  const t = d.save_invest_target;
  const inv = on("investing");
  const wk = on("work");
  const hideInv = ["allocation", "skipped", "below_min"];
  const base = inv ? d.warnings : d.warnings.filter((w) => !hideInv.includes(w.code));
  const warns = quiet ? base.filter((w) => w.code === "cap" || w.code === "liquidity") : base;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button className="rounded-full px-3 py-1 text-muted hover:text-ink" onClick={() => setMonth(shiftMonth(month, -1))}>←</button>
        <span className="text-lg">{monthName(month)}</span>
        <button className="rounded-full px-3 py-1 text-muted hover:text-ink" onClick={() => setMonth(shiftMonth(month, 1))}>→</button>
      </div>

      <Card className={d.liquidity.status === "below" ? "!border-warn/50" : ""}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-xl">
            <div className="mb-1 text-xs uppercase tracking-[0.18em] text-faint">Liquidity · {d.invest_priority === "cash" ? "cash first" : "free to invest"}</div>
            <p className="text-[0.98rem] leading-relaxed">{d.liquidity.message}</p>
          </div>
          <div className="text-right"><div className="num text-2xl">{money(d.liquid_cash_cents, cur)}</div><div className="text-xs text-faint">buffer {money(d.liquidity.floor_cents, cur)}</div></div>
        </div>
      </Card>

      {quiet && <p className="rounded-xl bg-surface2 px-4 py-2.5 text-sm text-muted">Exam focus is on, so only the things that really matter are shown. {focus?.exam?.title} is {focus?.exam?.days_away === 0 ? "today" : `in ${focus?.exam?.days_away} day${focus?.exam?.days_away === 1 ? "" : "s"}`}.</p>}
      {warns.length > 0 && (
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Worth a look</h2>
          <ul className="space-y-2 text-[0.95rem]">{warns.map((w) => <li key={w.code + w.text} className="flex gap-2"><span className={w.level === "warn" ? "text-warn" : "text-faint"}>•</span><span className="text-muted">{w.text}</span></li>)}</ul>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Income" value={money(d.income_cents + d.dividends_cents, cur)} hint={d.dividends_cents > 0 ? `incl. ${money(d.dividends_cents, cur)} dividends` : `expected ${money(d.expected_income.total_cents, cur)}`} />
        <Stat label="Spending vs cap" value={money(d.spending_cents, cur)} hint={`of ${money(d.cap_cents, cur)}${d.cap_cut_cents > 0 ? ` (${money(d.cap_cut_cents, cur)} less, from last month)` : ""} · ${pct(d.cap_used)}`} tone={spendTone} />
        <Stat label="Saved" value={money(d.savings_cents, cur)} hint={`savings rate ${pct(d.savings_rate)}`} />
        {on("investing") && <Stat label="Invested" value={money(d.investment_cents, cur)} hint={`min ${money(d.min_contribution_cents, cur)} · rate ${pct(d.investment_rate)}`} />}
      </div>
      <Card>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">Spending against your cap</h2><span className="text-sm text-muted">cap is a ceiling, not a target</span></div>
        <Bar value={d.cap_used ?? 0} tone={spendTone} />
        {Object.keys(d.spending_by_category).length > 0 && (
          <div className="mt-4 space-y-2">
            {Object.entries(d.spending_by_category).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
              <div key={c} className="flex items-center gap-3 text-sm"><span className="w-40 shrink-0 truncate text-muted">{c}</span><div className="flex-1"><Bar value={v / Math.max(1, d.spending_all_cents)} thin /></div><span className="num w-20 text-right">{money(v, cur)}</span></div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-faint">Investments are never counted as spending. Categories you've marked as outside the cap (like your car licence) show here but don't use it up.</p>
      </Card>

      {wk && (      <Card>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Work → income → net worth</h2>
          <span className="text-sm text-muted">Save + invest rate <span className="num text-ink">{pct(d.save_invest_rate)}</span> · target {money(t.low_cents, cur)}–{money(t.high_cents, cur)}/mo</span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
          {[["Hours worked", `${d.chain.hours}h`], ["Income", money(d.chain.income, cur)], ["Saved", money(d.chain.saved, cur)], ["Invested", money(d.chain.invested, cur)], ["Net worth", money(d.chain.net_worth, cur)]].map(([l, v], i) => (
            <div key={l} className="relative rounded-xl bg-surface2 px-2 py-3"><div className="text-xs text-faint">{l}</div><div className="num mt-0.5 text-lg">{v}</div>{i < 4 && <span className="absolute -right-2.5 top-1/2 z-10 hidden -translate-y-1/2 text-faint sm:block">→</span>}</div>
          ))}
        </div>
        <p className="mt-3 text-xs text-faint">More hours or a higher rate lift everything to the right — income is a lever, not just spending less.</p>
      </Card>)}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-baseline justify-between"><h2 className="text-lg font-semibold">Cash</h2><span className="num text-lg">{money(d.total_cash_cents, cur)}</span></div>
          <ul className="space-y-2.5">
            {d.pockets.map((p) => (
              <li key={p.id} className="flex items-center gap-3 text-sm">
                <span className="flex-1 truncate">{p.name}<span className="ml-2 text-xs text-faint">{PURPOSE_LABEL[p.purpose] ?? p.purpose}{p.provider ? ` · ${p.provider}` : ""}{!p.is_liquid ? " · not liquid" : ""}</span></span>
                <span className="num">{money(p.balance_cents, cur)}</span>
              </li>
            ))}
          </ul>
          <button className="mt-3 text-xs text-muted underline underline-offset-2 hover:text-ink" onClick={() => go("pockets")}>Manage pockets</button>
        </Card>

        {inv && (        <Card>
          <div className="mb-3 flex items-baseline justify-between"><h2 className="text-lg font-semibold">Portfolio</h2><span className="num text-lg">{money(d.portfolio.total_cents, cur)}</span></div>
          <div className="space-y-3">
            {d.portfolio.rows.map((r) => (
              <div key={r.ticker}>
                <div className="flex justify-between text-sm"><span>{r.ticker} <span className="text-xs text-faint">{r.status === "at_target" ? "at target" : r.status}</span></span><span className="num text-muted">{r.current_pct.toFixed(0)}% <span className="text-faint">/ {r.target_pct.toFixed(0)}%</span></span></div>
                <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-surface2"><div className="h-full rounded-full bg-orbit-finance/80" style={{ width: `${Math.min(100, r.current_pct)}%` }} /><span className="absolute top-0 h-full w-px bg-ink/70" style={{ left: `${r.target_pct}%` }} /></div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-faint">The line marks your target. {d.portfolio.suggestion_paused ? "Contribution suggestions are paused while cash is under your buffer." : d.portfolio.suggestion.length > 0 ? `Next contribution leans to ${d.portfolio.suggestion[0].ticker}.` : ""}</p>
          <button className="mt-1 text-xs text-muted underline underline-offset-2 hover:text-ink" onClick={() => go("portfolio")}>Open portfolio</button>
        </Card>)}
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Allocation of income</h2>
          <span className="text-sm text-muted">{d.allocation.unset ? "percentages not set yet" : d.allocation.valid ? "adds to 100%" : `adds to ${d.allocation.total_pct.toFixed(0)}% — should be 100%`}</span>
        </div>
        {d.allocation.unset ? <p className="text-sm text-muted">Set your own split under <button className="underline" onClick={() => go("rules")}>Rules</button>. Orbit doesn't assume one for you.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm">
            <thead><tr className="text-left text-xs text-faint"><th className="py-1 font-normal">Line</th><th className="font-normal">Target</th><th className="font-normal">Actual</th><th className="font-normal">Difference</th><th className="w-32 font-normal">Progress</th></tr></thead>
            <tbody>{d.allocation.rows.map((r) => (
              <tr key={r.key} className="border-t border-line">
                <td className="py-2">{r.label}{r.redirected === "in" && <span className="ml-2 text-xs text-warn">+ investing share, cash first</span>}{r.redirected === "out" && <span className="ml-2 text-xs text-warn">paused</span>}</td>
                <td className="num">{r.target_pct}% <span className="text-faint">· {money(r.effective_target_cents, cur)}</span></td>
                <td className="num">{money(r.actual_cents, cur)} <span className="text-faint">· {r.actual_pct.toFixed(0)}%</span></td>
                <td className={`num ${r.diff_cents < 0 && r.key !== "spending" ? "text-muted" : r.key === "spending" && r.diff_cents > 0 ? "text-neg" : ""}`}>{r.diff_cents > 0 ? "+" : ""}{money(r.diff_cents, cur)}</td>
                <td><Bar value={r.effective_target_cents > 0 ? r.actual_cents / r.effective_target_cents : 0} thin /></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>

      {d.goals.length > 0 && (
        <Card>
          <div className="mb-3 flex items-baseline justify-between"><h2 className="text-lg font-semibold">Goals</h2><button className="text-xs text-muted underline underline-offset-2 hover:text-ink" onClick={() => go("pockets")}>Manage</button></div>
          <div className="space-y-4">{d.goals.map((g) => (
            <div key={g.id}>
              <div className="flex flex-wrap justify-between gap-2 text-sm"><span>{g.title}</span><span className="num text-muted">{money(g.current_cents, cur)} of {money(g.target_cents, cur)}</span></div>
              <div className="mt-1"><Bar value={g.progress} /></div>
              <div className="mt-1 text-xs text-faint">{STATUS_TXT[g.status]}{g.required_monthly_cents != null && g.status !== "achieved" ? ` · needs ${money(g.required_monthly_cents, cur)}/mo` : ""}{g.actual_monthly_cents > 0 ? ` · recent pace ${money(g.actual_monthly_cents, cur)}/mo` : ""}</div>
            </div>))}</div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className={inv ? "lg:col-span-3" : "lg:col-span-5"}>
          <div className="mb-2 flex items-baseline justify-between"><h2 className="text-lg font-semibold">Net worth</h2><span className="num text-xl">{money(d.net_worth_cents, cur)}</span></div>
          {hist.data && <LineChart points={hist.data.snapshots.map((s) => ({ x: s.month, y: s.net_worth_cents }))} />}
          <p className="mt-2 text-xs text-faint">Assets {money(d.assets_cents, cur)} − liabilities {money(d.liabilities_cents, cur)}. Investments count; contributions are never expenses.</p>
        </Card>
        {inv && (        <Card className="lg:col-span-2">
          <h2 className="mb-2 text-lg font-semibold">Age checkpoint</h2>
          {d.milestone ? (
            <div className="space-y-2 text-sm">
              <Chip tone={d.milestone.status === "behind" ? "warn" : "pos"}>{d.milestone.status === "ahead" ? "Ahead" : d.milestone.status === "on_track" ? "On track" : "Behind your roadmap"}</Chip>
              <p className="text-muted">At {d.age}, your checkpoint is {money(d.milestone.checkpoint.nw_low_cents, cur)}{d.milestone.checkpoint.nw_high_cents ? `–${money(d.milestone.checkpoint.nw_high_cents, cur)}` : "+"}. You're {d.milestone.gap_to_low_cents >= 0 ? `${money(d.milestone.gap_to_low_cents, cur)} above` : `${money(-d.milestone.gap_to_low_cents, cur)} below`} its low end.</p>
              {d.milestone.next && <><Bar value={d.milestone.progress_to_next ?? 0} thin /><p className="text-xs text-faint">{pct(d.milestone.progress_to_next)} of the way to {money(d.milestone.next.nw_low_cents, cur)} (age {d.milestone.next.age})</p></>}
              <p className="text-xs text-faint">These are your own targets, not forecasts.</p>
            </div>
          ) : <p className="text-sm text-muted">Add your date of birth under <button className="underline" onClick={() => go("rules")}>Rules</button> to compare with your roadmap.</p>}
        </Card>)}
      </div>
    </div>
  );
}

/* ───────── Planning ───────── */
const VERDICT: Record<PlanResult["verdict"], { label: string; cls: string }> = {
  fits: { label: "Fits your rules", cls: "bg-pos/15 text-pos" },
  over_cap: { label: "Over your monthly cap", cls: "bg-warn/15 text-warn" },
  below_floor: { label: "Would breach your cash buffer", cls: "bg-neg/15 text-neg" },
  insufficient: { label: "Not enough in that pocket", cls: "bg-neg/15 text-neg" },
};

function Planning({ rev }: { rev: number }) {
  const { on } = usePrefs();
  const [wishRev, setWishRev] = useState(0);
  const [saved, setSaved] = useState(false);
  const cats = useAsync(() => api.categories(), [rev]);
  const pockets = useAsync(() => api.pockets(), [rev]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [cat, setCat] = useState("");
  const [pocket, setPocket] = useState("");
  const [res, setRes] = useState<PlanResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wishes = useAsync(() => api.wishlist(), [rev, wishRev]);
  const expense = (cats.data ?? []).filter((c) => c.kind === "expense" && !c.archived);
  const catId = cat || expense[0]?.id || "";

  const ask = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const cents = toCents(price);
    if (!(cents > 0)) return setErr("Enter a price above zero.");
    setBusy(true);
    setSaved(false);
    try { setRes(await api.plan({ name: name || undefined, price_cents: cents, category_id: catId, pocket_id: pocket || null })); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const v = res ? VERDICT[res.verdict] : null;
  const addWish = async () => {
    const cents = toCents(price);
    try { await api.addWish({ name: name.trim() || "Something I want", price_cents: cents, category_id: catId }); setSaved(true); setWishRev((n) => n + 1); } catch (x) { setErr((x as Error).message); }
  };
  const recheck = (w: { name: string; price_cents: number; category_id: string }) => { setName(w.name); setPrice(String(w.price_cents / 100)); setCat(w.category_id); setSaved(true); window.scrollTo({ top: 0, behavior: "smooth" }); };
  return (
    <div className="grid gap-5 md:grid-cols-5">
      <Card className="md:col-span-2">
        <h2 className="mb-1 text-lg font-semibold">Planning a purchase</h2>
        <p className="mb-4 text-sm text-muted">Orbit checks it against <em>your</em> cap, buffer and pockets — nothing generic.</p>
        <form onSubmit={ask} className="space-y-3">
          <Field label="What is it? (optional)"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Noise-cancelling headphones" /></Field>
          <Field label="Price"><input className={inputCls} type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" /></Field>
          <Field label="Category"><select className={inputCls} value={catId} onChange={(e) => setCat(e.target.value)}>{expense.map((c) => <option key={c.id} value={c.id}>{c.name}{c.counts_toward_cap ? "" : " (outside cap)"}</option>)}</select></Field>
          <Field label="Pay from"><select className={inputCls} value={pocket} onChange={(e) => setPocket(e.target.value)}><option value="">Everyday cash</option>{(pockets.data ?? []).filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.balance_cents)}</option>)}</select></Field>
          <ErrorNote msg={err} />
          <Button type="submit" disabled={busy} className="w-full">{busy ? "Checking…" : "Check against my rules"}</Button>
        </form>
      </Card>
      <div className="md:col-span-3">
        {!res || !v ? <Card className="flex h-full min-h-48 items-center justify-center text-center text-muted">Your answer will appear here.</Card> : (
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center gap-3"><span className={`rounded-full px-3 py-1 text-sm ${v.cls}`}>{v.label}</span>{res.name && <span className="text-sm text-muted">{res.name}</span>}</div>
            {res.flags.length > 0 && <ul className="space-y-1.5 text-[0.98rem]">{res.flags.map((f, i) => <li key={i} className="flex gap-2"><span className="text-warn">•</span><span>{f}</span></li>)}</ul>}
            {res.facts.length > 0 && <ul className="space-y-1.5 text-[0.95rem] text-muted">{res.facts.map((f, i) => <li key={i} className="flex gap-2"><span className="text-faint">–</span><span>{f}</span></li>)}</ul>}
            {on("work") && res.work_hours != null && res.hourly_rate_cents != null && <p className="text-sm"><span className="num text-ink">≈ {res.work_hours} hours of work</span> <span className="text-muted">at {money(res.hourly_rate_cents)}/h, before tax.</span></p>}
            {on("work") && res.work_hours == null && <p className="text-xs text-faint">Add an hourly job rate under Income to see this in hours of work.</p>}
            {res.investing_note && <p className="rounded-xl bg-surface2 px-3 py-2 text-sm">{res.investing_note}</p>}
            {res.suggestion && <p className="text-sm text-sun">{res.suggestion}</p>}
            {res.verdict !== "fits" && (saved
              ? <p className="text-sm text-muted">On your wishlist. Orbit will keep re-checking it against your rules.</p>
              : <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface2 px-3 py-2.5 text-sm"><span className="text-muted">Not a good moment? You don't have to decide now.</span><Button type="button" variant="ghost" className="border border-line2" onClick={addWish}>Add to wishlist</Button></div>)}
            <p className="text-xs text-faint">This applies the rules you set. It isn't professional financial advice, and the decision is yours.</p>
          </Card>
        )}
      </div>
      {(wishes.data?.length ?? 0) > 0 && (
        <Card className="md:col-span-5">
          <h2 className="mb-1 text-lg font-semibold">Wishlist</h2>
          <p className="mb-3 text-sm text-muted">Re-checked against your current rules each time you open this.</p>
          <ul className="divide-y divide-line">{wishes.data!.map((w) => {
            const vv = VERDICT[w.verdict];
            return (
              <li key={w.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <div className="min-w-0 flex-1"><div className="truncate">{w.name}</div><div className="text-xs text-faint">{w.verdict === "fits" ? "Fits your rules right now." : w.flags[0]}</div></div>
                <span className="num">{money(w.price_cents)}{on("work") && w.work_hours != null && <span className="ml-1.5 text-xs text-faint">≈ {w.work_hours}h</span>}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs ${vv.cls}`}>{w.verdict === "fits" ? "Fits now" : "Not yet"}</span>
                <button className="text-xs text-muted hover:text-ink" onClick={() => recheck(w)}>Check again</button>
                <button className="text-xs text-faint hover:text-neg" onClick={async () => { await api.removeWish(w.id); setWishRev((n) => n + 1); }}>Remove</button>
              </li>);
          })}</ul>
        </Card>)}
    </div>
  );
}

/* ───────── Activity ───────── */
const KINDS: [EntryKind, string][] = [["expense", "Expense"], ["income", "Income"], ["transfer", "Move money"], ["contribution", "Investment"], ["dividend", "Dividend"]];

function Activity({ rev, bump }: { rev: number; bump: () => void }) {
  const { on } = usePrefs();
  const [view, setView] = useState<"entries" | "statement" | "import">("entries");
  return (
    <div className="space-y-5">
      <div className="flex gap-1.5">{(["entries", "statement", "import"] as const).filter((v) => v !== "import" || on("import")).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-full border px-4 py-1.5 text-sm ${view === v ? "border-ink bg-ink text-bg" : "border-line2 text-muted hover:text-ink"}`}>{v === "entries" ? "Entries" : v === "statement" ? "Monthly statement" : "Import"}</button>)}</div>
      {view === "entries" ? <Entries rev={rev} bump={bump} /> : view === "statement" ? <Statement rev={rev} bump={bump} /> : <ImportStatements rev={rev} bump={bump} />}
    </div>
  );
}

function Entries({ rev, bump }: { rev: number; bump: () => void }) {
  const { on } = usePrefs();
  const [month, setMonth] = useState(monthKey(new Date()));
  const entries = useAsync(() => api.entries(month), [rev, month]);
  const cats = useAsync(() => api.categories(), [rev]);
  const pockets = useAsync(() => api.pockets(), [rev]);
  const holdings = useAsync(() => api.holdings(), [rev]);
  const [kind, setKind] = useState<EntryKind>("expense");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [catId, setCatId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [hold, setHold] = useState("");
  const [units, setUnits] = useState("");
  const [rec, setRec] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newCat, setNewCat] = useState("");
  const [newCap, setNewCap] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [manage, setManage] = useState(false);

  const pk = (pockets.data ?? []).filter((p) => !p.archived);
  const editingCat = editId ? entries.data?.find((x) => x.id === editId)?.category_id : null;
  const cl = (cats.data ?? []).filter((c) => c.kind === (kind === "income" ? "income" : "expense") && (!c.archived || c.id === editingCat));
  const catSel = catId && cl.some((c) => c.id === catId) ? catId : cl[0]?.id ?? "";
  const fromSel = from || pk.find((p) => p.purpose === "main")?.id || pk[0]?.id || "";
  const toSel = to || (kind === "transfer" ? pk.find((p) => p.purpose === "emergency")?.id : pk.find((p) => p.purpose === "main")?.id) || pk[0]?.id || "";
  const holdSel = hold || holdings.data?.find((h) => !h.archived)?.id || "";
  const sel = (v: string, set: (s: string) => void, list: { id: string; name: string }[], none?: string) => (
    <select className={inputCls} value={v} onChange={(e) => set(e.target.value)}>{none && <option value="">{none}</option>}{list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const cents = toCents(amt);
    if (!(cents > 0)) return setErr("Enter an amount above zero.");
    const base = { kind, amount_cents: cents, occurred_on: date, note: note || null, recurring: rec };
    const save = (b: NewEntry) => (editId ? api.updateEntry(editId, b) : api.addEntry(b));
    try {
      if (kind === "expense") await save({ ...base, category_id: catSel, from_pocket_id: fromSel });
      else if (kind === "income") await save({ ...base, category_id: catSel, to_pocket_id: toSel });
      else if (kind === "transfer") await save({ ...base, from_pocket_id: fromSel, to_pocket_id: toSel });
      else if (kind === "contribution") await save({ ...base, holding_id: holdSel, from_pocket_id: from || null, units: units ? Number(units) : null });
      else await save({ ...base, holding_id: holdSel, to_pocket_id: to || null });
      setAmt(""); setNote(""); setUnits(""); setEditId(null); bump();
    } catch (x) { setErr((x as Error).message); }
  };
  const addCat = async () => { if (!newCat.trim()) return; try { await api.addCategory({ name: newCat.trim(), kind: kind === "income" ? "income" : "expense", counts_toward_cap: newCap }); setNewCat(""); bump(); } catch (x) { setErr((x as Error).message); } };
  const startEdit = (e: Entry) => {
    setEditId(e.id); setKind(e.kind); setAmt(String(e.amount_cents / 100)); setDate(e.occurred_on); setNote(e.note ?? "");
    setCatId(e.category_id ?? ""); setFrom(e.from_pocket_id ?? ""); setTo(e.to_pocket_id ?? ""); setHold(e.holding_id ?? ""); setUnits(e.units ? String(e.units) : ""); setRec(e.recurring); setErr(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const cancelEdit = () => { setEditId(null); setAmt(""); setNote(""); setUnits(""); setErr(null); };
  const removeCat = async (id: string) => { try { await api.patchCategory(id, { archived: true }); if (catId === id) setCatId(""); bump(); } catch (x) { setErr((x as Error).message); } };
  const nameOf = (e: Entry) => e.kind === "expense" || e.kind === "income" ? cats.data?.find((c) => c.id === e.category_id)?.name ?? "—"
    : e.kind === "transfer" ? `${pockets.data?.find((p) => p.id === e.from_pocket_id)?.name} → ${pockets.data?.find((p) => p.id === e.to_pocket_id)?.name}`
    : `${holdings.data?.find((h) => h.id === e.holding_id)?.ticker ?? ""} ${e.kind === "dividend" ? "dividend" : "contribution"}`;
  const sign = (k: EntryKind) => (k === "income" || k === "dividend" ? "+" : k === "expense" ? "−" : "");

  return (
    <div className="grid gap-5 md:grid-cols-5">
      <Card className="md:col-span-2">
        <h2 className="mb-3 text-lg font-semibold">{editId ? "Edit entry" : "Add an entry"}</h2>
        <div className="mb-3 flex flex-wrap gap-1.5">{KINDS.filter(([k]) => on("investing") || (k !== "contribution" && k !== "dividend")).map(([k, l]) => <button type="button" key={k} onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 text-sm ${kind === k ? "border-ink bg-ink text-bg" : "border-line2 text-muted"}`}>{l}</button>)}</div>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Amount"><input className={inputCls} type="number" min="0" step="0.01" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0.00" /></Field>
          {(kind === "expense" || kind === "income") && (
            <Field label="Category">
              <div className="space-y-2">{sel(catSel, setCatId, cl.map((c) => ({ id: c.id, name: c.name + (kind === "expense" && !c.counts_toward_cap ? " (outside cap)" : "") })))}
                <div className="flex gap-2"><input className={inputCls} value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Or create a category…" />
                  <Button type="button" variant="ghost" className="border border-line2" onClick={addCat}>Add</Button></div>
                <div><button type="button" className="text-xs text-muted underline underline-offset-2 hover:text-ink" onClick={() => setManage(!manage)}>{manage ? "Done" : "Remove a category"}</button></div>
                {manage && (
                  <ul className="divide-y divide-line rounded-lg bg-surface2 px-3 text-sm">{cl.filter((c) => !c.archived).map((c) => (
                    <li key={c.id} className="flex items-center justify-between py-1.5"><span>{c.name}</span><button type="button" className="text-xs text-faint hover:text-neg" onClick={() => removeCat(c.id)}>Remove</button></li>))}
                    <li className="py-1.5 text-xs text-faint">Removing hides it from now on. Past entries keep their category.</li></ul>)}
                {kind === "expense" && newCat && <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={newCap} onChange={(e) => setNewCap(e.target.checked)} /> Counts toward my monthly spending cap</label>}</div>
            </Field>)}
          {(kind === "expense" || kind === "transfer") && <Field label={kind === "expense" ? "Paid from" : "From"}>{sel(fromSel, setFrom, pk)}</Field>}
          {(kind === "income" || kind === "transfer") && <Field label={kind === "income" ? "Lands in" : "To"}>{sel(toSel, setTo, pk)}</Field>}
          {(kind === "contribution" || kind === "dividend") && <Field label="Holding">{sel(holdSel, setHold, (holdings.data ?? []).filter((h) => !h.archived).map((h) => ({ id: h.id, name: h.ticker })))}</Field>}
          {kind === "contribution" && <>
            <Field label="Units bought (optional)"><input className={inputCls} type="number" min="0" step="any" value={units} onChange={(e) => setUnits(e.target.value)} /></Field>
            <Field label="Paid from (optional)">{sel(from, setFrom, pk, "Outside my tracked cash")}</Field></>}
          {kind === "dividend" && <Field label="Paid into (optional)">{sel(to, setTo, pk, "Reinvested / outside")}</Field>}
          <Field label="Date"><input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Note (optional)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {kind === "expense" && <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={rec} onChange={(e) => setRec(e.target.checked)} /> Repeats monthly</label>}
          {kind === "contribution" && <p className="text-xs text-faint">Investments are tracked separately and never count as spending.</p>}
          <ErrorNote msg={err} />
          <div className="flex gap-2"><Button type="submit" className="flex-1">{editId ? "Save changes" : "Add"}</Button>{editId && <Button type="button" variant="ghost" className="border border-line2" onClick={cancelEdit}>Cancel</Button>}</div>
        </form>
      </Card>
      <Card className="md:col-span-3">
        <div className="mb-3 flex items-center justify-between"><button className="px-2 text-muted hover:text-ink" onClick={() => setMonth(shiftMonth(month, -1))}>←</button><h2 className="text-lg font-semibold">{monthName(month)}</h2><button className="px-2 text-muted hover:text-ink" onClick={() => setMonth(shiftMonth(month, 1))}>→</button></div>
        {entries.data && entries.data.length === 0 && <p className="py-6 text-center text-muted">Nothing logged for this month yet.</p>}
        <ul className="divide-y divide-line">{entries.data?.map((e) => (
          <li key={e.id} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1"><div className="truncate">{nameOf(e)}{e.recurring && <span className="ml-2 text-xs text-faint">monthly</span>}</div><div className="truncate text-xs text-faint">{new Date(e.occurred_on + "T00:00").toLocaleDateString([], { day: "numeric", month: "short" })} · {e.kind}{e.note ? ` · ${e.note}` : ""}</div></div>
            <span className={`num ${e.kind === "income" || e.kind === "dividend" ? "text-pos" : ""}`}>{sign(e.kind)}{money(e.amount_cents)}</span>
            <button className="text-xs text-muted hover:text-ink" onClick={() => startEdit(e)}>Edit</button>
            <button aria-label="Delete" className="text-faint hover:text-neg" onClick={async () => { await api.deleteEntry(e.id); if (editId === e.id) cancelEdit(); bump(); }}>✕</button>
          </li>))}</ul>
      </Card>
    </div>
  );
}
