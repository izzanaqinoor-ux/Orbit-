/**
 * Turns a brief or a set of lectures into pieces you can do over time, and spreads them across the days you have.
 * It is plain text analysis and arithmetic, with no AI service and no cost. Everything it proposes is editable
 * before anything is created, because a brief is only ever a document and you know the course better than it does.
 */
import type { Doc } from "./pdf";

export interface Piece { id: string; title: string; minutes: number; notes: string; continueFrom?: string; source?: string }
export interface Placement { pieceId: string; start: number; end: number }

const DAY = 86400000;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
const uid = () => Math.random().toString(36).slice(2, 9);
const words = (s: string) => (s.match(/\S+/g) ?? []).length;
const shorten = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…");
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/* ───────────────────────── dates ───────────────────────── */

/** A date written near "due", "deadline" or "submit". Day-first, as in Singapore. Returns null if none is clear. */
export function findDueDate(text: string, today = new Date()): Date | null {
  const key = /(due|deadline|submi(?:t|ssion)|hand[- ]?in)/gi;
  const date = new RegExp(
    String.raw`(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{4})?` +
    String.raw`|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?` +
    String.raw`|(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})`, "i");
  const found: Date[] = [];
  let k: RegExpExecArray | null;
  while ((k = key.exec(text))) {
    const m = date.exec(text.slice(k.index, k.index + 120));
    if (!m) continue;
    let d: number, mo: number, y: number | undefined;
    if (m[1]) { d = +m[1]; mo = MONTHS.indexOf(m[2].toLowerCase().slice(0, 3)); y = m[3] ? +m[3] : undefined; }
    else if (m[4]) { mo = MONTHS.indexOf(m[4].toLowerCase().slice(0, 3)); d = +m[5]; y = m[6] ? +m[6] : undefined; }
    else { d = +m[7]; mo = +m[8] - 1; y = +m[9] < 100 ? 2000 + +m[9] : +m[9]; }
    if (mo < 0 || mo > 11 || d < 1 || d > 31) continue;
    let when = new Date(y ?? today.getFullYear(), mo, d);
    if (y === undefined && when.getTime() < startOfDay(today).getTime() - 30 * DAY) when = new Date(today.getFullYear() + 1, mo, d);
    found.push(when);
  }
  found.sort((a, b) => a.getTime() - b.getTime());
  return found.find((d) => d.getTime() >= startOfDay(today).getTime()) ?? found[found.length - 1] ?? null;
}

/* ───────────────────────── assignments ───────────────────────── */

export interface Brief { title: string; due: Date | null; weightPct: number | null; deliverables: string[] }

const ACTION = /\b(submit|prepare|write|develop|present|analy[sz]e|design|create|include|compare|evaluate|discuss|explain|identify|research|build|implement|produce|record|conduct|survey|interview|draft|outline|critique|reflect|summari[sz]e|propose|recommend|calculate|test|review|plan)\b/i;
const HEADING = /^(task|part|question|section|deliverable|component|stage|milestone|phase|objective|requirement)\s*([0-9]+[a-z]?|[a-z]|[ivx]+)\b\s*[:.\-–—)]?\s*(.*)$/i;
const BULLET = /^(?:\(?\d{1,2}[).]|\(?[a-z][).]|[-•▪●◦*–])\s+(.{12,}?)$/i;

export function parseBrief(doc: Doc, today = new Date()): Brief {
  const text = doc.pages.join("\n");
  const lines = text.split(/\n+/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  const title = lines.find((l) => l.length >= 6 && l.length <= 90 && !/^page\b|^\d+$/i.test(l)) ?? doc.name;
  const w = /(\d{1,3})\s?%/.exec(text.slice(0, 4000));
  const out: string[] = [];
  const add = (s: string) => {
    const t = shorten(s.replace(/^[\s:–—-]+/, "").replace(/\.$/, ""), 95);
    if (t.length >= 8 && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  for (const l of lines) {
    const h = HEADING.exec(l);
    if (h) { add(h[3] ? `${h[1][0].toUpperCase() + h[1].slice(1).toLowerCase()} ${h[2]}: ${h[3]}` : `${h[1][0].toUpperCase() + h[1].slice(1).toLowerCase()} ${h[2]}`); continue; }
    const b = BULLET.exec(l);
    if (b && ACTION.test(b[1]) && b[1].length <= 200) add(b[1]);
    if (out.length >= 8) break;
  }
  return { title: shorten(title, 80), due: findDueDate(text, today), weightPct: w ? +w[1] : null, deliverables: out.slice(0, 8) };
}

/** Hours a piece of work of this weight usually needs, as a starting point only. */
export const defaultHours = (weightPct: number | null) => (weightPct == null ? 10 : weightPct >= 40 ? 24 : weightPct >= 30 ? 16 : weightPct >= 20 ? 10 : 6);

const STAGES: [string, number][] = [
  ["Read the brief and plan the approach", 8], ["Research and gather sources", 17], ["Outline the structure", 8],
  ["First draft", 40], ["Review against the brief", 15], ["Polish and submit", 12],
];

/** Pieces for an assignment: one per deliverable if the brief had any, otherwise the usual stages of a project. */
export function assignmentPieces(brief: Brief, totalMinutes: number): Piece[] {
  const plan: [string, number][] = brief.deliverables.length >= 2
    ? [["Read the brief and plan the approach", 6], ...brief.deliverables.map((d): [string, number] => [d, 70 / brief.deliverables.length]), ["Review against the brief", 14], ["Polish and submit", 10]]
    : STAGES;
  const sum = plan.reduce((n, p) => n + p[1], 0);
  return plan.map(([title, wt]) => ({ id: uid(), title, minutes: round5((totalMinutes * wt) / sum), notes: "" }));
}

/* ───────────────────────── lectures ───────────────────────── */

export interface Lecture { title: string; source: string; pages: string[]; firstPage: number }

const LEC = /^(week|lecture|chapter|topic|unit|module)\s*(\d{1,2})\b[\s:.\-–—]*(.*)$/i;
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** One lecture per file, or several if a single file has "Week 3 / Lecture 4" style title pages. */
export function splitLectures(docs: Doc[]): Lecture[] {
  const out: Lecture[] = [];
  for (const d of [...docs].sort((a, b) => natural(a.name, b.name))) {
    const starts: { at: number; title: string }[] = [];
    d.pages.forEach((p, i) => {
      for (const l of p.split("\n").slice(0, 3)) {
        const m = LEC.exec(l.trim());
        if (m) { starts.push({ at: i, title: shorten(`${m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()} ${m[2]}${m[3] ? ` · ${m[3].trim()}` : ""}`, 80) }); break; }
      }
    });
    const distinct = new Set(starts.map((s) => s.title.split(" · ")[0]));
    if (starts.length >= 2 && distinct.size >= 2) {
      starts.forEach((s, i) => { const end = i + 1 < starts.length ? starts[i + 1].at : d.pages.length; if (!out.some((o) => o.title === s.title && o.source === d.name)) out.push({ title: s.title, source: d.name, pages: d.pages.slice(s.at, end), firstPage: s.at + 1 }); });
    } else {
      const first = starts[0]?.title;
      out.push({ title: first ?? shorten(d.name, 80), source: d.name, pages: d.pages, firstPage: 1 });
    }
  }
  return out;
}

/** Study time for a lecture: reading it properly plus a little per page for thinking and making notes. */
export const lectureMinutes = (l: Lecture) => Math.min(360, Math.max(30, round5(words(l.pages.join(" ")) / 60 + l.pages.length * 2)));

const sentences = (s: string) => s.replace(/\n+/g, " ").split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length >= 40 && x.length <= 180);
const KEY = /(\bis\b|\bare\b|\bmeans\b|\brefers? to\b|\bdefined\b|\bknown as\b|:|\d)/i;

/** A starting set of notes for these pages: each page's heading and its most definition-like sentence. */
export function notesFor(pages: string[], firstPage: number): string {
  const lines: string[] = [];
  pages.forEach((p, i) => {
    const heading = p.split("\n").map((l) => l.trim()).find((l) => l.length >= 4 && l.length <= 90 && !/^\d+$/.test(l));
    const best = sentences(p).map((s) => ({ s, score: (KEY.test(s) ? 2 : 0) + (s.length > 70 ? 1 : 0) })).sort((a, b) => b.score - a.score)[0];
    if (heading || best) lines.push(`- p.${firstPage + i} ${heading ?? ""}${best && best.s !== heading ? ` — ${best.s}` : ""}`.trim());
  });
  return lines.slice(0, 12).join("\n").slice(0, 2200);
}

/** Splits a lecture into sessions of about `sessionMin` minutes, each starting where the last one stopped. */
export function lectureSessions(l: Lecture, sessionMin: number): Piece[] {
  const total = lectureMinutes(l), n = Math.max(1, Math.ceil(total / sessionMin));
  const wc = l.pages.map((p) => words(p) + 25), all = wc.reduce((a, b) => a + b, 0);
  const cuts = [0];
  let acc = 0;
  for (let i = 0; i < wc.length && cuts.length < n; i++) { acc += wc[i]; if (acc >= (all * cuts.length) / n) cuts.push(i + 1); }
  while (cuts.length < n) cuts.push(Math.min(l.pages.length, cuts[cuts.length - 1] + 1));
  cuts.push(l.pages.length);
  const pieces: Piece[] = [];
  for (let k = 0; k < n; k++) {
    const a = cuts[k], b = Math.max(a + 1, cuts[k + 1]), part = l.pages.slice(a, b);
    if (!part.length) continue;
    const p1 = l.firstPage + a, p2 = l.firstPage + b - 1;
    const head = part[0].split("\n").map((x) => x.trim()).find((x) => x.length >= 4 && x.length <= 90 && !/^\d+$/.test(x));
    pieces.push({
      id: uid(), title: n > 1 ? `${l.title} · part ${k + 1} of ${n}` : l.title, minutes: round5(total / n),
      continueFrom: k > 0 ? `p.${p1}${head ? ` "${head}"` : ""}` : undefined, source: l.source,
      notes: `Pages ${p1}–${p2}${k > 0 ? `. Part ${k} ended on p.${p1 - 1}.` : ""}\n${notesFor(part, p1)}`.trim(),
    });
  }
  return pieces;
}

/** The text stored with a piece: where to pick up, where it came from, then the notes starter. */
export function describe(p: Piece): string {
  return [p.continueFrom ? `Continue from: ${p.continueFrom}` : "", p.source ? `Source: ${p.source}` : "", p.notes].filter(Boolean).join("\n");
}
export const continueLine = (d: string | null) => (d?.split("\n").find((l) => l.startsWith("Continue from:")) ?? null)?.replace("Continue from: ", "") ?? null;

/* ───────────────────────── scheduling ───────────────────────── */

export interface Busy { start: number; end: number }
export interface ScheduleOpts { first: Date; last: Date; chunkMin: number; maxPerDay: number; busy: Busy[]; now?: number; dayStartH?: number; dayEndH?: number }

/** The earliest gap of `minutes` on `day` that is free of anything already scheduled, inside waking hours. */
export function freeSlot(busy: Busy[], day: Date, minutes: number, o: { now?: number; dayStartH?: number; dayEndH?: number } = {}): number | null {
  const lo = new Date(day.getFullYear(), day.getMonth(), day.getDate(), o.dayStartH ?? 9).getTime();
  const hi = new Date(day.getFullYear(), day.getMonth(), day.getDate(), o.dayEndH ?? 21).getTime();
  let t = Math.max(lo, o.now ? Math.ceil((o.now + 30 * 60000) / (15 * 60000)) * 15 * 60000 : lo);
  const rows = busy.filter((b) => b.end > lo && b.start < hi).sort((a, b) => a.start - b.start);
  for (let guard = 0; guard < 60; guard++) {
    const hit = rows.find((b) => b.start < t + minutes * 60000 + 10 * 60000 && b.end + 10 * 60000 > t);
    if (!hit) return t + minutes * 60000 <= hi ? t : null;
    t = Math.ceil((hit.end + 10 * 60000) / (15 * 60000)) * 15 * 60000;
  }
  return null;
}

/**
 * Spreads sessions evenly from the first to the last day so the work never piles up at the end. If a day is full or
 * has no gap, a session slides to the next day that has room. Anything that cannot be placed is reported.
 */
export function schedule(pieces: Piece[], o: ScheduleOpts): { placements: Placement[]; unplaced: string[] } {
  const days: Date[] = [];
  for (let d = startOfDay(o.first); d.getTime() <= startOfDay(o.last).getTime() && days.length < 400; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push(d);
  if (days.length === 0) days.push(startOfDay(o.first));
  const sessions = pieces.flatMap((p) => {
    const n = Math.max(1, Math.ceil(p.minutes / o.chunkMin));
    return Array.from({ length: n }, () => ({ pieceId: p.id, minutes: round5(p.minutes / n) }));
  });
  const busy = [...o.busy], load = days.map(() => 0), placements: Placement[] = [], unplaced: string[] = [];
  sessions.forEach((s, k) => {
    const target = Math.min(days.length - 1, Math.floor((k * days.length) / sessions.length));
    const order = [...days.keys()].sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b).filter((i) => i >= target).concat([...days.keys()].filter((i) => i < target).reverse());
    for (const i of order) {
      if (load[i] + s.minutes > o.maxPerDay) continue;
      const at = freeSlot(busy, days[i], s.minutes, { now: o.now, dayStartH: o.dayStartH, dayEndH: o.dayEndH });
      if (at == null) continue;
      const end = at + s.minutes * 60000;
      placements.push({ pieceId: s.pieceId, start: at, end }); busy.push({ start: at, end }); load[i] += s.minutes;
      return;
    }
    unplaced.push(s.pieceId);
  });
  return { placements: placements.sort((a, b) => a.start - b.start), unplaced };
}
