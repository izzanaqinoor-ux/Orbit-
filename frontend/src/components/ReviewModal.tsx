import { useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import { addDays, money, pct, ymd } from "../lib";
import { ErrorNote, Modal } from "./ui";

const fmt = (iso: string) => new Date(iso + "T00:00").toLocaleDateString([], { day: "numeric", month: "short" });

/** A plain, factual look back at one week. No scores, no advice. */
export function ReviewModal({ onClose }: { onClose: () => void }) {
  const [week, setWeek] = useState<string | undefined>(undefined);
  const r = useAsync(() => api.review(week), [week]);
  const d = r.data;
  const step = (n: number) => { if (d) setWeek(ymd(addDays(new Date(d.week_start + "T00:00"), 7 * n))); };
  return (
    <Modal title="Weekly review" onClose={onClose}>
      <div className="mb-3 flex items-center justify-between text-sm">
        <button className="rounded-full px-3 py-1 text-muted hover:text-ink" onClick={() => step(-1)} aria-label="Previous week">←</button>
        <span>{d ? `${fmt(d.week_start)} – ${fmt(d.week_end)}` : "…"}{d?.is_current ? " · this week" : ""}</span>
        <button className="rounded-full px-3 py-1 text-muted hover:text-ink disabled:opacity-30" disabled={!d || d.is_current} onClick={() => step(1)} aria-label="Next week">→</button>
      </div>
      <ErrorNote msg={r.error} />
      {d && (
        <div className="space-y-4 text-sm">
          <section>
            <h3 className="mb-1 text-xs uppercase tracking-[0.18em] text-faint">Time</h3>
            <p>{+d.hours_scheduled.toFixed(1)}h of work scheduled{d.hours_scheduled > 0 ? ` (${+d.hours_so_far.toFixed(1)}h so far)` : ""}, {d.study_hours}h of study logged.</p>
            {d.done_count > 0 ? <p className="text-muted">{d.done_count} thing{d.done_count === 1 ? "" : "s"} finished: {d.done.map((x) => x.title).join(", ")}{d.done_count > d.done.length ? "…" : ""}.</p> : <p className="text-muted">Nothing marked finished.</p>}
          </section>
          <section>
            <h3 className="mb-1 text-xs uppercase tracking-[0.18em] text-faint">Money</h3>
            <p>Received {money(d.income_logged_cents, d.currency)}, spent {money(d.spent_cents, d.currency)}{d.invested_cents > 0 ? `, invested ${money(d.invested_cents, d.currency)}` : ""}.</p>
            {d.top_categories.length > 0 && <p className="text-muted">Mostly {d.top_categories.map((c) => `${c.name} (${money(c.cents, d.currency)})`).join(", ")}.</p>}
            {d.weekly_cap_cents > 0 && <p className="text-muted">{money(d.spent_toward_cap_cents, d.currency)} of about {money(d.weekly_cap_cents, d.currency)} weekly cap.</p>}
            {d.spent_in_work_hours != null && d.spent_in_work_hours > 0 && <p className="text-muted">About {d.spent_in_work_hours} hours of work, at your rate.</p>}
          </section>
          <section>
            <h3 className="mb-1 text-xs uppercase tracking-[0.18em] text-faint">What moved</h3>
            <p>Cash {d.cash_change_cents >= 0 ? "went up" : "went down"} by {money(Math.abs(d.cash_change_cents), d.currency)}, to {money(d.cash_end_cents, d.currency)}.</p>
            {d.goals.length > 0 && <ul className="mt-1 text-muted">{d.goals.map((g) => <li key={g.title}>{g.title}: {pct(g.progress)}</li>)}</ul>}
          </section>
        </div>)}
    </Modal>
  );
}
