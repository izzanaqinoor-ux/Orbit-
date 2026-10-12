import type { PlanetColor } from "./types";

export const PSTYLE: Record<PlanetColor, { dot: string; soft: string; text: string; bar: string }> = {
  study:    { dot: "bg-orbit-study",    soft: "bg-orbit-study/15 border-orbit-study/40",       text: "text-orbit-study" , bar: "bg-orbit-study/75 text-bg" },
  work:     { dot: "bg-orbit-work",     soft: "bg-orbit-work/15 border-orbit-work/40",         text: "text-orbit-work" , bar: "bg-orbit-work/75 text-bg" },
  personal: { dot: "bg-orbit-personal", soft: "bg-orbit-personal/15 border-orbit-personal/40", text: "text-orbit-personal" , bar: "bg-orbit-personal/75 text-bg" },
  other:    { dot: "bg-orbit-other",    soft: "bg-orbit-other/15 border-orbit-other/40",       text: "text-orbit-other" , bar: "bg-orbit-other/75 text-bg" },
  finance:  { dot: "bg-orbit-finance",  soft: "bg-orbit-finance/15 border-orbit-finance/40",   text: "text-orbit-finance" , bar: "bg-orbit-finance/75 text-bg" },
  rose:     { dot: "bg-orbit-rose",     soft: "bg-orbit-rose/15 border-orbit-rose/40",         text: "text-orbit-rose" , bar: "bg-orbit-rose/75 text-bg" },
  sand:     { dot: "bg-orbit-sand",     soft: "bg-orbit-sand/15 border-orbit-sand/40",         text: "text-orbit-sand" , bar: "bg-orbit-sand/75 text-bg" },
  violet:   { dot: "bg-orbit-violet",   soft: "bg-orbit-violet/15 border-orbit-violet/40",     text: "text-orbit-violet" , bar: "bg-orbit-violet/75 text-bg" },
};
/** Colour/tint for the WebGL planets (multiplied over the planet's base surface). */
export const PTINT: Record<PlanetColor, [number, number, number]> = {
  study: [1, 1, 1], work: [1, 1, 1], personal: [1, 1, 1], other: [1, 1, 1], finance: [1, 1, 1],
  rose: [1.25, 0.8, 0.92], sand: [1.18, 1.05, 0.8], violet: [1.0, 0.78, 1.6],
};

export function hours(min: number): string {
  const m = Math.round(Math.abs(min));
  const h = Math.floor(m / 60), r = m % 60;
  const s = h === 0 ? `${r}m` : r === 0 ? `${h}h` : `${h}h ${r}m`;
  return min < 0 ? `−${s}` : s;
}

export const mondayOf = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b);
export const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const dayLabel = (d: Date) => d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

/** `<input type="datetime-local">` value -> ISO string with the browser's offset. */
export const localInputToISO = (v: string) => new Date(v).toISOString();
export const toLocalInput = (d: Date) => `${ymd(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export const endOfDayISO = (dateStr: string) => new Date(dateStr + "T23:59:00").toISOString();
export const dueLabel = (iso: string, allDay: boolean) =>
  allDay ? new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })
         : new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export const money = (c: number, cur = "SGD") => {
  const a = Math.abs(Math.round(c)), sym = cur === "SGD" ? "S$" : cur + " ";
  const body = a % 100 === 0 ? (a / 100).toLocaleString("en-US") : (a / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${c < 0 ? "-" : ""}${sym}${body}`;
};
export const pct = (x: number | null | undefined, d = 0) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);

/** Where the person is inside a tab (Finance sub-page etc.), so feedback can say exactly where it was sent from. */
export const where = { sub: "" };

/** An all-day (or several-day) event is stored as local midnight to local midnight, a whole number of days. */
export function isAllDay(startISO: string, endISO: string): boolean {
  const s = new Date(startISO), e = new Date(endISO);
  const mid = (d: Date) => d.getHours() === 0 && d.getMinutes() === 0;
  return mid(s) && mid(e) && e.getTime() - s.getTime() >= 23 * 3600000;
}
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
