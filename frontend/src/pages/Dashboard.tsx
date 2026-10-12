import { useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import { Card, Button, ErrorNote } from "../components/ui";
import { CapacityOrbit, Legend } from "../components/CapacityOrbit";
import { freeSlot } from "../study/breakdown";
import { useRest } from "../settings";
import { PlanTimeForm } from "../components/PlanTimeForm";
import { usePlanets } from "../planets";
import { addDays, dayLabel, dueLabel, hours, mondayOf, startOfDay, timeLabel, ymd } from "../lib";
import { OccasionsModal } from "../components/OccasionsModal";
import { ReviewModal } from "../components/ReviewModal";
import { isAllDay } from "../lib";
import { useFocus } from "../focus";
import { usePrefs } from "../prefs";
import { Bar } from "./financeUi";
import { money } from "../lib";
import type { CommitmentDemand, Occasion, WeekSummary } from "../types";

const whenLabel = (o: Occasion) => o.days_away === 0 ? "Today" : o.days_away === 1 ? "Tomorrow" : o.days_away < 7 ? new Date(o.date + "T00:00").toLocaleDateString([], { weekday: "long" }) : new Date(o.date + "T00:00").toLocaleDateString([], { day: "numeric", month: "short" });

function MoneyWeek({ w, work }: { w: WeekSummary; work: boolean }) {
  const cur = w.currency, cap = w.weekly_cap_cents;
  const noData = (!work || w.hours_scheduled === 0) && w.income_logged_cents === 0 && w.spent_cents === 0;
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between"><h2 className="font-semibold">Money this week</h2><span className="text-xs text-faint">from your hours and entries</span></div>
      {noData ? <p className="text-sm text-muted">Nothing yet. Entries you log will show up here{work ? ", along with the shifts you schedule" : ""}.</p> : (
        <div className="space-y-4 text-sm">
          {work && <div className="grid grid-cols-2 gap-3">
            <div><p className="text-xs text-faint">Hours worked</p><p className="num text-xl">{+w.hours_so_far.toFixed(1)}h <span className="text-sm text-muted">of {+w.hours_scheduled.toFixed(1)}h</span></p></div>
            <div><p className="text-xs text-faint">Earned from them</p><p className="num text-xl">{money(w.earned_so_far_cents, cur)} <span className="text-sm text-muted">of {money(w.expected_pay_cents, cur)}</span></p></div>
          </div>}
          <div className="grid grid-cols-3 gap-3 border-t border-line pt-3">
            <div><p className="text-xs text-faint">Received</p><p className="num text-pos">{money(w.income_logged_cents, cur)}</p></div>
            <div><p className="text-xs text-faint">Spent</p><p className="num">{money(w.spent_cents, cur)}</p></div>
            <div><p className="text-xs text-faint">Left</p><p className={`num ${w.left_cents < 0 ? "text-neg" : ""}`}>{w.left_cents < 0 ? "−" : ""}{money(Math.abs(w.left_cents), cur)}</p></div>
          </div>
          {cap > 0 && <div><Bar value={w.spent_toward_cap_cents / cap} thin /><p className="mt-1 text-xs text-faint">{money(w.spent_toward_cap_cents, cur)} of about {money(cap, cur)} a week toward your cap</p></div>}
          {work && w.spent_in_work_hours != null && w.spent_in_work_hours > 0 && <p className="text-xs text-muted">That spending is roughly {w.spent_in_work_hours} hours of your work.</p>}
          {w.top_categories.length > 0 && <p className="text-xs text-faint">Mostly {w.top_categories.map((c) => `${c.name} (${money(c.cents, cur)})`).join(", ")}</p>}
        </div>)}
    </Card>
  );
}

export default function Dashboard({ rev, bump }: { rev: number; bump: () => void }) {
  const { style } = usePlanets();
  const { on } = usePrefs();
  const cap = useAsync(() => api.capacity(), [rev]);
  const today = new Date();
  const day = useAsync(() => api.calendar(new Date(ymd(today) + "T00:00").toISOString(), addDays(new Date(ymd(today) + "T00:00"), 1).toISOString()), [rev]);
  const open = useAsync(() => api.openDemand(), [rev]);
  const [plan, setPlan] = useState<CommitmentDemand | null>(null);
  const [rest] = useRest();
  const ahead = useAsync(() => api.calendar(new Date().toISOString(), addDays(new Date(), 28).toISOString()), [rev]);
  const [adding, setAdding] = useState<string | null>(null);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const week = useAsync(() => (on("finance") ? api.weekSummary() : Promise.resolve(null)), [rev, on("finance")]);
  const soon = useAsync(() => (on("occasions") ? api.occasions(ymd(today), ymd(addDays(today, 30))) : Promise.resolve([])), [rev, on("occasions")]);
  const [occ, setOcc] = useState(false);
  const [review, setReview] = useState(false);
  const focus = useFocus();

  // A suggested slot for each piece of waiting work: the nearest gap inside your waking hours before it is due,
  // never on top of anything already planned or on top of another suggestion.
  const waiting = (open.data ?? []).filter((d) => d.unallocated_demand_minutes > 0);
  const suggestions = new Map<string, { start: number; end: number }[]>();
  const short = new Map<string, number>();   // minutes that found no gap before the due day
  if (ahead.data) {
    const busy = ahead.data.filter((i) => !isAllDay(i.start_at, i.end_at) && i.status !== "cancelled").map((i) => ({ start: new Date(i.start_at).getTime(), end: new Date(i.end_at).getTime() }));
    for (const d of waiting) {
      const last = d.due_at && new Date(d.due_at) > new Date() ? startOfDay(new Date(d.due_at)) : addDays(startOfDay(new Date()), 14);
      const slots: { start: number; end: number }[] = [];
      let left = d.unallocated_demand_minutes;
      for (let day = startOfDay(new Date()); day <= last && left > 0; day = addDays(day, 1)) {
        while (left > 0 && slots.length < 6) {
          const mins = Math.max(15, Math.min(left, 120));
          const at = freeSlot(busy, day, mins, { now: Date.now(), dayStartH: rest.before, dayEndH: rest.after });
          if (at === null) break;
          const slot = { start: at, end: at + mins * 60000 };
          slots.push(slot); busy.push(slot); left -= mins;
          if (slots.length % 2 === 0) break;   // at most two sessions a day, so it doesn't swallow the day
        }
      }
      suggestions.set(d.commitment_id, slots);
      if (left > 0) short.set(d.commitment_id, left);
    }
  }
  const addSuggested = async (d: CommitmentDemand) => {
    const sg = suggestions.get(d.commitment_id) ?? []; if (!sg.length) return;
    setAdding(d.commitment_id); setPlanErr(null);
    try { for (const x of sg) await api.addTimeBlock(d.commitment_id, new Date(x.start).toISOString(), new Date(x.end).toISOString()); bump(); }
    catch (e) { setPlanErr((e as Error).message); } finally { setAdding(null); }
  };

  if (cap.error) return <ErrorNote msg={cap.error} />;
  if (!cap.data) return <p className="text-muted">Loading…</p>;
  const c = cap.data;
  const wk = mondayOf(new Date(c.week_start));
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl tracking-tight">{today.getHours() < 12 ? "Good morning" : today.getHours() < 18 ? "Good afternoon" : "Good evening"}</h1>
        <p className="text-sm text-muted">This week · {wk.toLocaleDateString([], { day: "numeric", month: "long" })} – {addDays(wk, 6).toLocaleDateString([], { day: "numeric", month: "long" })}</p>
      </div>

      {focus?.active && focus.exam && (
        <Card className="!border-orbit-study/50">
          <p className="text-xs uppercase tracking-[0.18em] text-faint">Exam focus</p>
          <p className="mt-1 text-[1.05rem]">{focus.exam.title} is {focus.exam.days_away === 0 ? "today" : focus.exam.days_away === 1 ? "tomorrow" : `in ${focus.exam.days_away} days`}.</p>
          <p className="text-sm text-muted">{focus.study_hours_planned > 0 ? `${focus.study_hours_planned}h of study is planned before it.` : "No study time is planned before it yet. The work-waiting list below is where you can add some."} Money reminders are paused until it's over.</p>
        </Card>)}

      {on("review") && today.getDay() === 0 && !focus?.active && <button className="w-full rounded-xl border border-line2 bg-surface px-4 py-3 text-left text-sm hover:border-ink" onClick={() => setReview(true)}><span className="font-medium">Your week in review</span> <span className="text-muted">— hours, money and what moved</span></button>}

      <div className="flex flex-wrap items-center gap-2">
        {on("occasions") && (soon.data ?? []).slice(0, 4).map((o) => (
          <span key={o.id + o.date} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${o.days_away <= 7 ? "border-sun/50 bg-sun/10 text-ink" : "border-line2 text-muted"}`}>
            <span className="text-sun">◆</span><span>{o.title}</span><span className="text-xs text-muted">{whenLabel(o)}{o.time ? ` · ${o.time.slice(0, 5)}` : ""}</span>
          </span>))}
        {on("occasions") && <button className="rounded-full border border-line2 px-3 py-1.5 text-xs text-muted hover:border-ink hover:text-ink" onClick={() => setOcc(true)}>{(soon.data ?? []).length ? "Occasions" : "+ Add a special occasion"}</button>}
        {on("review") && <button className="rounded-full border border-line2 px-3 py-1.5 text-xs text-muted hover:border-ink hover:text-ink" onClick={() => setReview(true)}>Weekly review</button>}
      </div>

      <div className="grid gap-5 md:grid-cols-5">
        <div className="space-y-5 md:col-span-2">
          <Card><CapacityOrbit cap={c} /><div className="mt-4"><Legend cap={c} /></div></Card>
          {on("finance") && week.data && <MoneyWeek w={week.data} work={on("work")} />}
        </div>

        <div className="space-y-5 md:col-span-3">
          <Card>
            <h2 className="mb-3 font-semibold">Today</h2>
            {day.data?.length ? (
              <ul className="space-y-2">
                {day.data.map((i) => (
                  <li key={(i.time_block_id ?? i.commitment_id) + i.start_at} className="flex items-center gap-3 text-sm">
                    <span className={`h-8 w-1 rounded-full ${style(i.planet_id, i.category).dot}`} />
                    <span className="w-40 shrink-0 whitespace-nowrap tabular-nums text-muted">{timeLabel(i.start_at)} – {timeLabel(i.end_at)}</span>
                    <span className="font-medium">{i.title}</span>
                    {i.kind === "time_block" && <span className="rounded bg-surface2 px-1.5 py-0.5 text-xs text-muted">work block</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Nothing scheduled today.</p>}
          </Card>

          <Card>
            <h2 className="mb-1 font-semibold">Work waiting for time</h2>
            <p className="mb-3 text-sm text-muted">Flexible work that still has no time set aside. Once it's planned it leaves this list.</p>
            <ErrorNote msg={planErr} />
            {waiting.length === 0 ? <p className="text-sm text-muted">Nothing waiting. Everything has a slot.</p> : (
              <ul className="divide-y divide-line">
                {waiting.map((d) => {
                  const sg = suggestions.get(d.commitment_id) ?? [];
                  return (
                    <li key={d.commitment_id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{d.title}</p>
                        <p className="text-xs text-muted">
                          {d.due_at ? `due ${dueLabel(d.due_at, d.due_all_day)} · ` : ""}{hours(d.unallocated_demand_minutes)} unplanned
                        </p>
                        {ahead.data && (sg.length > 0
                          ? <p className="mt-0.5 text-xs text-ink/70">Suggested: {sg.map((x) => `${dayLabel(new Date(x.start))}, ${timeLabel(new Date(x.start).toISOString())} – ${timeLabel(new Date(x.end).toISOString())}`).join(" · ")}</p>
                          : <p className="mt-0.5 text-xs text-warn">No free gap found before it's due. Try another day.</p>)}
                        {short.get(d.commitment_id) && sg.length > 0 && <p className="mt-0.5 text-xs text-warn">{hours(short.get(d.commitment_id)!)} more won't fit before it's due.</p>}
                      </div>
                      <div className="flex gap-1">
                        {sg.length > 0 && <Button disabled={adding === d.commitment_id} onClick={() => void addSuggested(d)}>{sg.length > 1 ? `Add all ${sg.length}` : "Add it"}</Button>}
                        <Button variant="ghost" onClick={() => setPlan(d)}>{sg.length ? "Other time" : "Plan time"}</Button>
                      </div>
                    </li>);
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {review && <ReviewModal onClose={() => setReview(false)} />}
      {occ && <OccasionsModal onClose={() => setOcc(false)} onDone={() => { soon.reload(); }} />}
      {plan && <PlanTimeForm commitmentId={plan.commitment_id} title={plan.title} defaultMinutes={plan.unallocated_demand_minutes || 60} onClose={() => setPlan(null)} onDone={bump} />}
    </div>
  );
}
