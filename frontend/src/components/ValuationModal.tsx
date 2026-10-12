import { useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import { Button, ErrorNote, inputCls, Modal } from "./ui";
import { money, pct } from "../lib";

const toCents = (v: string) => Math.round(parseFloat(v || "0") * 100);

/** Monthly check-in: what is each holding worth today? For your records only, never a buy/sell prompt. */
export function ValuationModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const v = useAsync(() => api.valuations(), []);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hs = v.data?.holdings ?? [];
  const cents = (id: string) => (vals[id] !== undefined && vals[id] !== "" ? toCents(vals[id]) : null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const values = hs.filter((h) => cents(h.id) !== null).map((h) => ({ holding_id: h.id, value_cents: cents(h.id)! }));
    if (values.length === 0) return setErr("Enter at least one value.");
    setBusy(true);
    try { await api.recordValuations(values); onDone(); onClose(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Monthly check-in" onClose={onClose}>
      <form onSubmit={save} className="space-y-4 text-sm">
        <p className="text-muted">What is each investment worth today? Read it off your broker. This is only for tracking how things are going over time. It isn't a signal to buy or sell.</p>
        <ErrorNote msg={err ?? v.error} />
        <ul className="divide-y divide-line">
          {hs.map((h) => {
            const c = cents(h.id);
            return (
              <li key={h.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <div className="min-w-0 flex-1"><p>{h.ticker}</p><p className="text-xs text-faint">paid {money(h.cost_cents)}{h.last_value_cents != null ? ` · last check-in ${money(h.last_value_cents)}` : ""}</p></div>
                <div className="text-right">
                  <input className={inputCls + " num w-32 text-right"} type="number" min="0" step="0.01" placeholder={h.last_value_cents != null ? String(h.last_value_cents / 100) : "worth now"} value={vals[h.id] ?? ""} onChange={(e) => setVals({ ...vals, [h.id]: e.target.value })} />
                  {c !== null && h.cost_cents > 0 && <p className={`mt-1 text-xs ${c >= h.cost_cents ? "text-pos" : "text-muted"}`}>{c >= h.cost_cents ? "+" : "−"}{money(Math.abs(c - h.cost_cents))} · {pct((c - h.cost_cents) / h.cost_cents, 1)} vs paid</p>}
                </div>
              </li>);
          })}
          {v.data && hs.length === 0 && <li className="py-3 text-muted">Add a holding under Portfolio first.</li>}
        </ul>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Not now</Button><Button disabled={busy || hs.length === 0}>{busy ? "Saving…" : "Save check-in"}</Button></div>
      </form>
    </Modal>
  );
}
