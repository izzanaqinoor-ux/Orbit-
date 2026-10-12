import type { WeekCapacity } from "../types";
import { hours } from "../lib";

/**
 * The one place the solar metaphor is literal-ish: you are the sun at the
 * centre; the inner ring is how the week's capacity is spoken for (fixed
 * time, then planned work), the outer thin ring is deadline demand that still
 * has no slot. Everything is derived from the API — nothing is stored here.
 */
export function CapacityOrbit({ cap }: { cap: WeekCapacity }) {
  const size = 240, c = size / 2;
  const r1 = 84, r2 = 108, w1 = 16, w2 = 6;
  const L1 = 2 * Math.PI * r1, L2 = 2 * Math.PI * r2;
  const total = Math.max(cap.weekly_capacity_minutes, cap.occupied_minutes, 1);
  const fixedLen = (cap.fixed_occupied_minutes / total) * L1;
  const planLen = (cap.planned_allocation_minutes / total) * L1;
  const press = Math.min(1, cap.deadline_pressure_minutes / Math.max(cap.weekly_capacity_minutes, 1));
  const over = cap.free_capacity_minutes < 0;

  const ring = (r: number, w: number, len: number, off: number, L: number, color: string) => (
    <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={w} strokeDasharray={`${Math.max(len, 0)} ${L}`} strokeDashoffset={-off} transform={`rotate(-90 ${c} ${c})`} />
  );

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-[260px]" role="img"
      aria-label={`${hours(cap.free_capacity_minutes)} free of ${hours(cap.weekly_capacity_minutes)} this week`}>
      <circle cx={c} cy={c} r={r1} fill="none" stroke="rgba(232,227,216,0.07)" strokeWidth={w1} />
      <circle cx={c} cy={c} r={r2} fill="none" stroke="rgba(232,227,216,0.05)" strokeWidth={w2} />
      {ring(r1, w1, fixedLen, 0, L1, "#c9c3b4")}
      {ring(r1, w1, planLen, fixedLen, L1, "#8ea8c3")}
      {ring(r2, w2, press * L2, 0, L2, "#c4876a")}
      <circle cx={c} cy={c} r={58} fill="#d8b273" opacity={0.10} />
      <circle cx={c} cy={c} r={46} fill="#d8b273" opacity={0.18} />
      <text x={c} y={c - 2} textAnchor="middle" className="fill-ink" fontSize={28} fontWeight={700}>{hours(cap.free_capacity_minutes)}</text>
      <text x={c} y={c + 18} textAnchor="middle" className="fill-muted" fontSize={11}>{over ? "over capacity" : "free this week"}</text>
    </svg>
  );
}

export function Legend({ cap }: { cap: WeekCapacity }) {
  const rows: [string, string, number][] = [
    ["bg-[#c9c3b4]", "Fixed commitments", cap.fixed_occupied_minutes],
    ["bg-orbit-study", "Planned work blocks", cap.planned_allocation_minutes],
    ["bg-orbit-work", "Deadline demand with no slot", cap.deadline_pressure_minutes],
  ];
  return (
    <ul className="space-y-2 text-sm">
      {rows.map(([dot, label, v]) => (
        <li key={label} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${dot}`} />{label}</span>
          <span className="font-medium tabular-nums">{hours(v)}</span>
        </li>
      ))}
      <li className="flex items-center justify-between gap-3 border-t border-line pt-2 text-muted">
        <span>Weekly capacity</span><span className="tabular-nums">{hours(cap.weekly_capacity_minutes)}</span>
      </li>
    </ul>
  );
}
