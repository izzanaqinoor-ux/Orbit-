import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { usePrefs } from "../prefs";
import { useAsync } from "../hooks";
import { OrbitStage, layout, type Body } from "../components/OrbitStage";
import { addDays, hours, mondayOf, money, PTINT } from "../lib";
import { usePlanets } from "../planets";
import { useOrbitLines } from "../settings";
import { PlanetsModal } from "../components/PlanetsModal";
import type { Category } from "../types";

type Tab = "dashboard" | "commitments" | "finance";
const KIND_TYPE: Record<Category, 1 | 2 | 3 | 4> = { study: 1, work: 2, personal: 3, other: 4 };
const dayFmt = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

export default function Space({ rev, onNavigate, bump }: { rev: number; onNavigate: (tab: Tab) => void; bump: () => void }) {
  const { planets } = usePlanets();
  const [managing, setManaging] = useState(false);
  const { on } = usePrefs();
  const showFin = on("finance");
  const NAMES = useMemo(() => ["You", ...planets.map((p) => p.name), ...(showFin ? ["Finance"] : [])], [planets, showFin]);
  const N = NAMES.length;
  const [offset, setOffset] = useState(0);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<"system" | "focus">("system");
  const [lineStyle] = useOrbitLines();
  const lines = lineStyle === "even" ? "classic" : "refined";
  const ws = useMemo(() => addDays(mondayOf(new Date()), offset * 7), [offset]);
  const we = useMemo(() => addDays(ws, 7), [ws]);

  const { data, error } = useAsync(async () => {
    const [items, demand, cmts, cap, fin] = await Promise.all([
      api.calendar(ws.toISOString(), we.toISOString()), api.openDemand(), api.commitments(),
      offset === 0 ? api.capacity() : Promise.resolve(null), showFin ? api.dashboard() : Promise.resolve(null),
    ]);
    return { items, demand, cmts, cap, fin };
  }, [rev, offset, showFin]);

  const model = useMemo(() => {
    if (!data) return null;
    const planetOf = new Map(data.cmts.map((c) => [c.id, c.planet_id ?? planets.find((p) => p.kind === c.category)?.id ?? ""]));
    const per = new Map<string, { pid: string; title: string; scheduled: number; waiting: number }>();
    const slot = (id: string, pid: string, title: string) => { if (!per.has(id)) per.set(id, { pid, title, scheduled: 0, waiting: 0 }); return per.get(id)!; };
    for (const i of data.items) {
      const a = Math.max(new Date(i.start_at).getTime(), ws.getTime()), b = Math.min(new Date(i.end_at).getTime(), we.getTime());
      slot(i.commitment_id, i.planet_id ?? planetOf.get(i.commitment_id) ?? "", i.title).scheduled += Math.max(0, (b - a) / 60000);
    }
    const nextDue = new Map<string, { title: string; at: number; unplanned: number }>();
    for (const d of data.demand) {
      const pid = planetOf.get(d.commitment_id) ?? "";
      const due = d.due_at ? new Date(d.due_at).getTime() : null;
      const inWeek = due !== null ? due >= ws.getTime() && due < we.getTime() : offset === 0;
      if (inWeek && d.unallocated_demand_minutes > 0) slot(d.commitment_id, pid, d.title).waiting += d.unallocated_demand_minutes;
      if (due !== null && d.remaining_demand_minutes > 0 && due >= ws.getTime() - 7 * 864e5 && (!nextDue.has(pid) || due < nextDue.get(pid)!.at))
        nextDue.set(pid, { title: d.title, at: due, unplanned: d.unfulfilled_deadline_demand_minutes });
    }
    const cats = planets.map((p) => {
      const rows = [...per.values()].filter((v) => v.pid === p.id).sort((a, b) => b.scheduled + b.waiting - a.scheduled - a.waiting);
      const scheduled = rows.reduce((n, r) => n + r.scheduled, 0), waiting = rows.reduce((n, r) => n + r.waiting, 0);
      return { planet: p, rows, scheduled, waiting, minutes: scheduled + waiting, due: nextDue.get(p.id) ?? null };
    });
    return { cats, max: Math.max(1, ...cats.map((c) => c.minutes)), total: cats.reduce((n, c) => n + c.minutes, 0) };
  }, [data, ws, we, offset, planets]);

  const fin = data?.fin ?? null;
  const cap = data?.cap;
  const finScale = !fin ? 0.4 : Math.max(0.35, Math.min(1, fin.cap_used ?? 0.4));
  const finSub = fin ? `${money(Math.max(0, fin.cap_cents - fin.spending_cents), fin.currency)} under cap` : "";

  const bodies: Body[] = useMemo(() => {
    const k = planets.length;
    // Before the week has loaded every orbit is "no deadline yet", so Finance starts in the outer lane
    // where it will usually settle, instead of snapping across the system when the data arrives.
    const rows = [...planets.map((_, i) => ({ idx: i + 1, urgent: model?.cats[i]?.due?.at ?? Infinity })), ...(showFin ? [{ idx: k + 1, urgent: Infinity }] : [])];
    const rank = new Map(rows.sort((a, b) => a.urgent - b.urgent || a.idx - b.idx).map((r, j) => [r.idx, j]));
    return [
      { type: 0, scale: 1, label: "You", sub: cap ? `${hours(Math.max(0, cap.free_capacity_minutes))} free` : "", rank: 0 },
      ...planets.map((p, i): Body => {
        const row = model?.cats[i];
        return { type: KIND_TYPE[p.kind], scale: row && row.minutes > 0 ? Math.sqrt(row.minutes / model!.max) : 0, label: p.name, sub: row ? hours(row.minutes) : "",
          rank: rank.get(i + 1) ?? i, seed: 1.3 + i * 4.1, tint: PTINT[p.color] };
      }),
      ...(showFin ? [{ type: 5 as const, scale: finScale, label: "Finance", sub: finSub, rank: rank.get(k + 1) ?? k }] : []),
    ];
  }, [model, cap, finScale, finSub, planets, showFin]);

  useEffect(() => { if (index >= N) { setIndex(0); setMode("system"); } }, [index, N]);
  const focus = (i: number) => { setIndex(i); setMode("focus"); };
  const step = (d: 1 | -1) => setIndex((i) => (i + d + N) % N);
  const panel = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 640 });
  useEffect(() => {
    const el = panel.current!; const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setMode("system");
    if (mode === "focus" && e.key === "ArrowRight") step(1);
    if (mode === "focus" && e.key === "ArrowLeft") step(-1);
  };

  // ── words ──
  const range = `${ws.toLocaleDateString([], { day: "numeric", month: "short" })} – ${addDays(ws, 6).toLocaleDateString([], { day: "numeric", month: "short" })}`;
  let eyebrow = "YOUR SYSTEM", title = "Orbit", body = `${N - 1} parts of your life, sized by what they hold right now. Choose one to look closer.`;
  let extra: string | null = null, warn: string | null = null, cta: string | null = null, go: Tab = "dashboard", tag: string | null = null;
  if (mode === "focus") {
    title = NAMES[index];
    if (index === 0) {
      eyebrow = "AT THE CENTRE"; cta = "See this week";
      body = cap
        ? `${hours(Math.abs(cap.free_capacity_minutes))} ${cap.free_capacity_minutes < 0 ? "over" : "free"} of your ${hours(cap.weekly_capacity_minutes)} this week. ${hours(cap.fixed_occupied_minutes)} is fixed and ${hours(cap.planned_allocation_minutes)} is planned work.`
        : model ? `Week of ${range}. ${hours(model.total)} is spoken for across your categories.` : "Gathering your week…";
    } else if (showFin && index === N - 1) {
      eyebrow = "MONEY · THIS MONTH"; cta = "Open finance"; go = "finance";
      body = fin
        ? `${money(fin.spending_cents, fin.currency)} of your ${money(fin.cap_cents, fin.currency)} spending cap is used. Liquid cash is ${money(fin.liquid_cash_cents, fin.currency)} and net worth ${money(fin.net_worth_cents, fin.currency)}.`
        : "Gathering your money picture…";
      if (fin) extra = fin.invest_priority === "cash" ? "Rebuild cash before extra investing." : fin.warnings[0]?.text ?? null;
    } else if (model?.cats[index - 1]) {
      const c = model.cats[index - 1];
      const n = c.rows.length;
      eyebrow = "CATEGORY"; cta = "Open commitments"; go = "commitments";
      body = c.minutes === 0 ? "Nothing in this orbit this week."
        : `${hours(c.minutes)} across ${n} ${n === 1 ? "commitment" : "commitments"}${c.waiting > 0 ? `, with ${hours(c.waiting)} still waiting for a slot` : ""}.`;
      if (c.due) extra = `Next deadline: ${c.due.title}, ${dayFmt(c.due.at)}.`;
      if (c.due && c.due.unplanned > 0) warn = `${hours(c.due.unplanned)} of that has no time set aside yet.`;
      if (c.minutes > 0 && c.minutes === model.max) tag = "Heaviest orbit this week";
    }
  }
  const top = mode === "focus" && index >= 1 && index <= N - 2 && model && size.h >= 700 && size.w >= 520 ? model.cats[index - 1].rows.slice(0, 3) : [];

  const label = (d: -1 | 1) => {
    const i = (index + d + N) % N, L = layout(size.w, size.h, d, i === 0 ? 1 : bodies[i].scale);
    const ringed = bodies[i].type === 1 || bodies[i].type === 5 ? L.r * 0.7 : 0;   // keep the name clear of a ring
    return { i, x: d < 0 ? L.x + L.r + 10 + ringed : size.w - (L.x - L.r) + 10 + ringed, y: L.y, sub: bodies[i].sub };
  };
  const left = label(-1), right = label(1);
  const focusMode = mode === "focus";
  const circ = "orbit-ui flex h-10 w-10 items-center justify-center rounded-full border border-ink/20 text-ink/70 transition hover:border-ink/45 hover:text-ink";
  const chip = "orbit-ui h-8 whitespace-nowrap rounded-full border border-ink/15 text-[11px] uppercase tracking-[0.14em] text-ink/70 transition hover:border-ink/35 hover:text-ink";

  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-neg/15 px-3 py-2 text-sm text-neg">{error}</p>}
      <div ref={panel} tabIndex={0} onKeyDown={onKey} role="region" aria-roledescription="carousel" aria-label="Your week as planets"
        style={{ background: "radial-gradient(ellipse 70% 55% at 50% 64%, rgba(58,38,22,0.22), rgba(7,9,12,0) 70%), #06080b" }}
        className="relative h-[clamp(600px,86vh,800px)] overflow-hidden rounded-2xl text-ink outline-none">
        <OrbitStage key={bodies.length} bodies={bodies} mode={mode} index={index} onPick={focus} onStep={step} orbitLines={lines} />

        <div className="absolute inset-x-0 top-0 z-10 px-5 pt-4 sm:px-8">
          <div className="grid grid-cols-[1fr_auto] items-center gap-4 pb-3 sm:grid-cols-[auto_1fr_auto]">
            <button onClick={() => setMode("system")} className="justify-self-start text-[22px] leading-none tracking-[0.05em]">Orbit<span className="text-sun">.</span></button>
            <nav aria-label="Planets" className="orbit-ui hidden justify-self-center gap-5 whitespace-nowrap text-[10.5px] uppercase tracking-[0.12em] sm:flex">
              <button onClick={() => setMode("system")} aria-current={!focusMode} className={`border-b pb-1 transition ${!focusMode ? "border-ink/40 text-ink" : "border-transparent text-ink/45 hover:text-ink/85"}`}>System</button>
              {NAMES.map((nm, i) => (
                <button key={nm} onClick={() => focus(i)} aria-current={focusMode && i === index} className={`border-b pb-1 transition ${focusMode && i === index ? "border-ink/40 text-ink" : "border-transparent text-ink/45 hover:text-ink/85"}`}>{nm}</button>
              ))}
            </nav>
            <div className="flex items-center justify-self-end"><div className={chip + " flex items-center px-1"}>
              <button className="px-2 text-ink/60 hover:text-ink" onClick={() => setOffset(offset - 1)} aria-label="Previous week">‹</button>
              <button className="min-w-[5.2rem] px-1 text-center" onClick={() => setOffset(0)}>{offset === 0 ? "This week" : range}</button>
              <button className="px-2 text-ink/60 hover:text-ink" onClick={() => setOffset(offset + 1)} aria-label="Next week">›</button>
            </div>
            <button className={chip + " ml-2 hidden px-3.5 sm:block"} onClick={() => setManaging(true)}>+ Planets</button></div>
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-ink/20 to-transparent" />
        </div>

        <div key={mode + index + "-" + offset} className="orbit-rise pointer-events-none absolute inset-x-0 top-[14%] z-10 flex flex-col items-center px-6 text-center" aria-live="polite">
          <p className="orbit-ui mb-3 text-[11px] uppercase tracking-[0.36em] text-ink/50">{eyebrow}</p>
          <h1 className={`font-normal leading-[0.95] tracking-[-0.025em] ${focusMode ? "text-[clamp(3.4rem,10vw,7rem)]" : "text-[clamp(2.6rem,6vw,4.2rem)]"}`}>{title}</h1>
          <p className="mt-5 max-w-[34rem] text-[15px] leading-[1.65] text-ink/65">{body}</p>
          {extra && <p className="mt-1 max-w-[34rem] text-[15px] leading-relaxed text-ink/55">{extra}</p>}
          {warn && <p className="mt-1 text-[15px] text-warn">{warn}</p>}
          {tag && size.h >= 640 && <p className="orbit-ui mt-3 text-[10px] uppercase tracking-[0.28em] text-ink/40">{tag}</p>}
          {cta && <button onClick={() => onNavigate(go)} className="orbit-ui pointer-events-auto mt-6 rounded-full border border-ink/30 px-6 py-2 text-[11px] uppercase tracking-[0.18em] text-ink/85 transition hover:border-ink/65 hover:text-ink">{cta}</button>}
          {top.length > 0 && <p className="mt-5 max-w-md text-xs text-ink/40">{top.map((r) => `${r.title} ${hours(r.scheduled + r.waiting)}`).join("   ·   ")}</p>}
        </div>

        {focusMode && <>
          <button onClick={() => step(-1)} className="absolute z-10 -translate-y-1/2 text-left" style={{ left: Math.min(left.x, size.w * 0.3), top: left.y }}>
            <span className="block text-xl text-ink/75">{NAMES[left.i]}</span><span className="orbit-ui block text-[10.5px] tracking-[0.08em] text-ink/40">{left.sub}</span>
          </button>
          <button onClick={() => step(1)} className="absolute z-10 -translate-y-1/2 text-right" style={{ right: Math.min(right.x, size.w * 0.3), top: right.y }}>
            <span className="block text-xl text-ink/75">{NAMES[right.i]}</span><span className="orbit-ui block text-[10.5px] tracking-[0.08em] text-ink/40">{right.sub}</span>
          </button>
          <button className={circ + " absolute bottom-5 left-5 z-10"} onClick={() => step(-1)} aria-label="Previous planet">‹</button>
          <button className={circ + " absolute bottom-5 right-5 z-10"} onClick={() => step(1)} aria-label="Next planet">›</button>
          <button onClick={() => setMode("system")} className="orbit-ui absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full border border-ink/20 px-5 py-1.5 text-[11px] uppercase tracking-[0.16em] text-ink/70 transition hover:border-ink/45 hover:text-ink">Back to the system</button>
        </>}
      </div>
      {managing && <PlanetsModal onClose={() => setManaging(false)} onDone={bump} />}
      <p className="text-sm text-muted">{focusMode ? "Bigger planet, more time or money in play. Drag, use the arrows, or pick a name." : "Planets drift around you. Bigger means more this week; closer means a sooner deadline."}</p>
    </div>
  );
}
