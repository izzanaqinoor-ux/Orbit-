import type { ReactNode } from "react";
import { Card } from "../components/ui";
import { money } from "../lib";

export const toCents = (v: string) => Math.round(parseFloat(v || "0") * 100);
export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const shiftMonth = (m: string, by: number) => { const [y, mo] = m.split("-").map(Number); return monthKey(new Date(y, mo - 1 + by, 1)); };
export const monthName = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 1, 1).toLocaleDateString([], { month: "long", year: "numeric" }); };

export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "neg" | "warn" }) {
  return (
    <Card className="!p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className={`num mt-1 text-2xl ${tone === "neg" ? "text-neg" : tone === "warn" ? "text-warn" : ""}`}>{value}</div>
      {hint && <div className="text-xs text-faint">{hint}</div>}
    </Card>
  );
}

export function Bar({ value, tone, thin }: { value: number; tone?: "neg" | "warn"; thin?: boolean }) {
  const c = tone === "neg" ? "bg-neg" : tone === "warn" ? "bg-warn" : "bg-orbit-finance";
  return <div className={`overflow-hidden rounded-full bg-surface2 ${thin ? "h-1.5" : "h-2.5"}`}><div className={`h-full rounded-full ${c}`} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, opacity: 0.85 }} /></div>;
}

export function Chip({ children, tone }: { children: ReactNode; tone?: "pos" | "warn" }) {
  return <span className={`inline-block rounded-full px-3 py-1 text-sm ${tone === "warn" ? "bg-warn/15 text-warn" : "bg-pos/15 text-pos"}`}>{children}</span>;
}

/** Minimal dependency-free line chart. */
export function LineChart({ points, bands }: { points: { x: string; y: number }[]; bands?: { x: string; lo: number; hi: number | null }[] }) {
  const W = 560, H = 190, P = { l: 8, r: 8, t: 14, b: 22 };
  if (points.length === 0) return <p className="text-sm text-muted">Your timeline starts the first time you open this page each month.</p>;
  const ys = [...points.map((p) => p.y), ...(bands ?? []).flatMap((b) => [b.lo, b.hi ?? b.lo])];
  const min = Math.min(0, ...ys), max = Math.max(1, ...ys);
  const xs = points.map((p) => p.x);
  const X = (i: number) => P.l + (xs.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (xs.length - 1));
  const Y = (v: number) => P.t + (1 - (v - min) / (max - min || 1)) * (H - P.t - P.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Net worth over time">
      <line x1={P.l} x2={W - P.r} y1={Y(0)} y2={Y(0)} stroke="currentColor" className="text-line2" />
      {points.length > 1 && <path d={`${d} L${X(points.length - 1)},${Y(0)} L${X(0)},${Y(0)} Z`} className="fill-orbit-finance/10" />}
      <path d={d} fill="none" strokeWidth={2} className="stroke-orbit-finance" strokeLinejoin="round" />
      {points.map((p, i) => <circle key={p.x} cx={X(i)} cy={Y(p.y)} r={3} className="fill-orbit-finance" />)}
      {points.map((p, i) => (i === 0 || i === points.length - 1 || points.length < 7) && <text key={"t" + p.x} x={X(i)} y={H - 6} textAnchor="middle" className="fill-faint" fontSize="10">{p.x.slice(2).replace("-", "/")}</text>)}
      <text x={X(points.length - 1)} y={Y(points[points.length - 1].y) - 8} textAnchor="end" className="fill-ink" fontSize="11">{money(points[points.length - 1].y)}</text>
    </svg>
  );
}

/** Growth paths chart (one line per assumed return). */
export function PathsChart({ paths }: { paths: { rate_pct: number; series: { year: number; value_cents: number }[] }[] }) {
  const W = 560, H = 200, P = { l: 8, r: 8, t: 14, b: 22 };
  const years = paths[0]?.series.length ?? 0;
  if (!years) return null;
  const max = Math.max(1, ...paths.flatMap((p) => p.series.map((s) => s.value_cents)));
  const X = (i: number) => P.l + (i * (W - P.l - P.r)) / Math.max(1, years - 1), Y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
  const cls = ["stroke-orbit-study", "stroke-orbit-finance", "stroke-orbit-work", "stroke-orbit-violet"];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Scenario projections (assumptions)">
      <line x1={P.l} x2={W - P.r} y1={Y(0)} y2={Y(0)} stroke="currentColor" className="text-line2" />
      {paths.map((p, k) => <path key={p.rate_pct} d={p.series.map((s, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(s.value_cents).toFixed(1)}`).join(" ")} fill="none" strokeWidth={2} className={cls[k % 4]} />)}
      {paths.map((p, k) => <text key={"l" + k} x={W - P.r} y={Y(p.series[p.series.length - 1].value_cents) - 5} textAnchor="end" className="fill-muted" fontSize="10">{p.rate_pct}% → {money(p.series[p.series.length - 1].value_cents)}</text>)}
      <text x={P.l} y={H - 6} className="fill-faint" fontSize="10">now</text><text x={W - P.r} y={H - 6} textAnchor="end" className="fill-faint" fontSize="10">year {years - 1}</text>
    </svg>
  );
}
