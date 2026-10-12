import { useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import { Button, Card, ErrorNote } from "../components/ui";
import { money } from "../lib";
import { monthName, shiftMonth, monthKey, toCents } from "./financeUi";

const dayLabel = (iso: string) => new Date(iso + "T00:00").toLocaleDateString([], { day: "numeric", month: "short" });
const signed = (c: number, cur: string) => `${c > 0 ? "+" : c < 0 ? "−" : ""}${money(Math.abs(c), cur)}`;

/** Monthly statement: a double-entry journal (every Dr has a matching Cr) plus a check against what you really have. */
export function Statement({ rev, bump }: { rev: number; bump: () => void }) {
  const [month, setMonth] = useState(monthKey(new Date()));
  const st = useAsync(() => api.statement(month), [rev, month]);
  const [actual, setActual] = useState<Record<string, string>>({});
  const [dest, setDest] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nav = (by: number) => { setMonth(shiftMonth(month, by)); setActual({}); setDest({}); setErr(null); };
  const s = st.data;
  const cur = s?.currency ?? "SGD";

  const entered = (s?.pockets ?? []).filter((p) => !p.close && actual[p.pocket_id] !== undefined && actual[p.pocket_id] !== "");
  const diffOf = (pid: string, books: number) => toCents(actual[pid]) - books;
  const surplus = entered.reduce((n, p) => n + Math.max(0, diffOf(p.pocket_id, p.closing_cents)), 0);
  const shortfall = entered.reduce((n, p) => n + Math.max(0, -diffOf(p.pocket_id, p.closing_cents)), 0);
  const destFor = (pid: string) => dest[pid] ?? s?.suggestion?.pocket_id ?? "";

  const reconcile = async () => {
    if (!s) return; setErr(null); setBusy(true);
    try {
      await api.settleStatement(month, entered.map((p) => ({ pocket_id: p.pocket_id, actual_cents: toCents(actual[p.pocket_id]), destination_pocket_id: diffOf(p.pocket_id, p.closing_cents) > 0 ? destFor(p.pocket_id) || null : null })));
      setActual({}); st.reload(); bump();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const undo = async (pid: string) => { try { await api.undoSettle(month, pid); st.reload(); bump(); } catch (x) { setErr((x as Error).message); } };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><button className="px-2 text-muted hover:text-ink" onClick={() => nav(-1)}>←</button><h2 className="text-lg font-semibold">{monthName(month)}</h2><button className="px-2 text-muted hover:text-ink" onClick={() => nav(1)}>→</button></div>
      <ErrorNote msg={err ?? st.error} />
      {!s ? <p className="text-muted">Loading…</p> : (<>
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Journal</h3>
            <span className={`rounded-full px-3 py-1 text-xs ${s.totals.tallies ? "bg-pos/15 text-pos" : "bg-neg/15 text-neg"}`}>{s.totals.tallies ? "Debits equal credits" : "Does not tally"}</span>
          </div>
          {s.journal.length === 0 ? <p className="py-4 text-center text-muted">No entries this month.</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm">
              <thead><tr className="text-left text-xs text-faint"><th className="w-16 py-1 font-normal">Date</th><th className="font-normal">Account</th><th className="w-28 text-right font-normal">Dr</th><th className="w-28 text-right font-normal">Cr</th></tr></thead>
              <tbody>{s.journal.map((j) => j.lines.map((l, i) => (
                <tr key={j.entry_id + i} className={i === 0 ? "border-t border-line" : ""}>
                  <td className="py-1 align-top text-xs text-faint">{i === 0 ? dayLabel(j.date) : ""}</td>
                  <td className={`py-1 ${l.cr_cents > 0 ? "pl-6 text-muted" : ""}`}>{l.account}{i === 0 && j.memo ? <span className="ml-2 text-xs text-faint">{j.memo}</span> : null}</td>
                  <td className="num py-1 text-right">{l.dr_cents ? money(l.dr_cents, cur) : ""}</td>
                  <td className="num py-1 text-right">{l.cr_cents ? money(l.cr_cents, cur) : ""}</td>
                </tr>)))}
                <tr className="border-t-2 border-line2 font-medium"><td /><td className="py-2">Total</td><td className="num text-right">{money(s.totals.dr_cents, cur)}</td><td className="num text-right">{money(s.totals.cr_cents, cur)}</td></tr>
              </tbody>
            </table></div>)}
          <p className="mt-3 text-xs text-faint">Each entry is recorded twice: where the money went (Dr) and where it came from (Cr). Investments are assets, not spending.</p>
        </Card>

        <Card>
          <h3 className="font-semibold">Does it match what you actually have?</h3>
          <p className="mb-3 mt-1 text-sm text-muted">Cash you received or spent and forgot to enter will show up as a difference. Count what's really in each place and type it in.</p>
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-xs text-faint"><th className="py-1 font-normal">Pocket</th><th className="text-right font-normal">Opening</th><th className="text-right font-normal">In</th><th className="text-right font-normal">Out</th><th className="text-right font-normal">Books say</th><th className="w-36 text-right font-normal">You have</th></tr></thead>
            <tbody>{s.pockets.map((p) => {
              const d = !p.close && actual[p.pocket_id] ? diffOf(p.pocket_id, p.closing_cents) : null;
              return (
                <tr key={p.pocket_id} className="border-t border-line align-top">
                  <td className="py-2">{p.name}</td>
                  <td className="num py-2 text-right text-muted">{money(p.opening_cents, cur)}</td>
                  <td className="num py-2 text-right text-muted">{money(p.in_cents, cur)}</td>
                  <td className="num py-2 text-right text-muted">{money(p.out_cents, cur)}</td>
                  <td className="num py-2 text-right">{money(p.closing_cents, cur)}</td>
                  <td className="py-2 text-right">
                    {p.close ? (
                      <div className="text-xs"><span className={p.close.diff_cents === 0 ? "text-pos" : "text-sun"}>{p.close.diff_cents === 0 ? "Matched" : `Reconciled ${signed(p.close.diff_cents, cur)}`}</span>
                        <button className="ml-2 text-faint underline hover:text-ink" onClick={() => undo(p.pocket_id)}>undo</button></div>
                    ) : s.is_future ? <span className="text-xs text-faint">—</span> : (<>
                      <input className="num w-28 rounded-lg border border-line2 bg-surface2 px-2 py-1 text-right" type="number" min="0" step="0.01" placeholder="count it" value={actual[p.pocket_id] ?? ""} onChange={(e) => setActual({ ...actual, [p.pocket_id]: e.target.value })} />
                      {d !== null && <div className={`mt-1 text-xs ${d === 0 ? "text-pos" : d > 0 ? "text-sun" : "text-warn"}`}>{d === 0 ? "Matches" : d > 0 ? `${money(d, cur)} not entered` : `${money(-d, cur)} short`}</div>}
                    </>)}
                  </td>
                </tr>);
            })}</tbody>
          </table></div>

          {entered.some((p) => diffOf(p.pocket_id, p.closing_cents) > 0) && (
            <div className="mt-4 space-y-2 rounded-xl bg-surface2 p-3 text-sm">
              <p><span className="text-sun">{money(surplus, cur)}</span> more than your records. It will be booked as “Unrecorded cash” income, then moved to:</p>
              {entered.filter((p) => diffOf(p.pocket_id, p.closing_cents) > 0).map((p) => (
                <div key={p.pocket_id} className="flex flex-wrap items-center gap-2">
                  <span className="text-muted">{p.name} →</span>
                  <select className="rounded-lg border border-line2 bg-surface px-2 py-1" value={destFor(p.pocket_id)} onChange={(e) => setDest({ ...dest, [p.pocket_id]: e.target.value })}>
                    <option value="">Leave it there</option>{s.pockets.filter((q) => q.pocket_id !== p.pocket_id).map((q) => <option key={q.pocket_id} value={q.pocket_id}>{q.name}</option>)}
                  </select>
                </div>))}
              {s.suggestion && <p className="text-xs text-muted">Suggested: {s.suggestion.name}. {s.suggestion.reason}</p>}
            </div>)}
          {shortfall > 0 && (
            <div className="mt-3 rounded-xl bg-warn/10 p-3 text-sm text-warn">
              {money(shortfall, cur)} less than your records. It will be booked as “Unrecorded spending” (outside this month's cap, so it isn't counted twice), and next month's spending cap goes from {money(s.next_month_cap.base_cents, cur)} to {money(Math.max(0, s.next_month_cap.base_cents - s.next_month_cap.cut_cents - shortfall), cur)}.
            </div>)}
          {s.next_month_cap.cut_cents > 0 && entered.length === 0 && <p className="mt-3 text-sm text-muted">Next month's cap is {money(s.next_month_cap.effective_cents, cur)} instead of {money(s.next_month_cap.base_cents, cur)}, to make up for spending that wasn't entered.</p>}
          {entered.length > 0 && <div className="mt-4"><Button onClick={reconcile} disabled={busy}>{busy ? "Reconciling…" : "Reconcile"}</Button></div>}
        </Card>
      </>)}
    </div>
  );
}
