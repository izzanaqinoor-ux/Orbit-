import { useState } from "react";
import { Card } from "./ui";
import { money } from "../lib";
import type { GoalView } from "../types";

const when = (months: number) => { const d = new Date(); d.setMonth(d.getMonth() + months); return d.toLocaleDateString([], { month: "short", year: "numeric" }); };

/** Slide a couple of levers and watch goal dates move. Nothing here is saved or advised; it's arithmetic. */
export function WhatIf({ goals, rateCents, cur }: { goals: GoalView[]; rateCents: number | null; cur: string }) {
  const [hrs, setHrs] = useState(0);
  const [less, setLess] = useState(0);
  const open = goals.filter((g) => g.status !== "achieved" && g.remaining_cents > 0);
  if (open.length === 0) return null;
  const extra = Math.round(hrs * (rateCents ?? 0) * 52 / 12) + less * 100;
  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">What if…</h2>
      <p className="mb-4 text-sm text-muted">Try a lever and see how your goal dates move. Nothing is saved, and it isn't a suggestion.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 flex justify-between text-muted"><span>Work more hours a week</span><span className="num text-ink">+{hrs}h</span></span>
          <input type="range" min={0} max={20} value={hrs} onChange={(e) => setHrs(+e.target.value)} disabled={!rateCents} className="w-full accent-sun" />
          <span className="text-xs text-faint">{rateCents ? `At your main job's ${money(rateCents, cur)}/h that's about ${money(Math.round(hrs * rateCents * 52 / 12), cur)} a month, before any tax.` : "Set an hourly main job under Income to use this."}</span>
        </label>
        <label className="block text-sm">
          <span className="mb-1 flex justify-between text-muted"><span>Spend less each month</span><span className="num text-ink">{money(less * 100, cur)}</span></span>
          <input type="range" min={0} max={500} step={10} value={less} onChange={(e) => setLess(+e.target.value)} className="w-full accent-sun" />
          <span className="text-xs text-faint">Money you'd otherwise have spent.</span>
        </label>
      </div>
      <ul className="mt-4 divide-y divide-line text-sm">
        {open.map((g) => {
          const base = g.actual_monthly_cents;
          const now = base > 0 ? Math.ceil(g.remaining_cents / base) : null;
          const next = base + extra > 0 ? Math.ceil(g.remaining_cents / (base + extra)) : null;
          const meets = g.required_monthly_cents != null && base + extra >= g.required_monthly_cents;
          return (
            <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
              <span className="min-w-0 flex-1 truncate">{g.title}</span>
              <span className="text-muted">{now != null ? `${when(now)}` : "no pace yet"}</span>
              <span className="text-faint">→</span>
              <span className={`num ${extra > 0 && next != null ? "text-pos" : "text-muted"}`}>{next != null ? when(next) : "—"}{now != null && next != null && now > next ? ` (${now - next} mo sooner)` : ""}</span>
              {g.required_monthly_cents != null && extra > 0 && <span className={`text-xs ${meets ? "text-pos" : "text-faint"}`}>{meets ? "meets its deadline" : "still short of its deadline"}</span>}
            </li>);
        })}
      </ul>
      <p className="mt-3 text-xs text-faint">Assumes the extra goes entirely to that goal, on top of your recent pace.</p>
    </Card>
  );
}
