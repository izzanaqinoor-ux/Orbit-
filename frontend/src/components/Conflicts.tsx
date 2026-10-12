import { api } from "../api";
import { useAsync } from "../hooks";
import { addDays, isAllDay, startOfDay, timeLabel } from "../lib";
import { useRest } from "../settings";
import { freeSlot } from "../study/breakdown";
import type { CalendarItem } from "../types";

export interface Slot { start: Date; end: Date }
export interface Clash { slot: Slot; item: CalendarItem }

const dayShort = (d: Date) => d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

/** Which existing items already occupy these slots? All-day markers never clash with timed slots. */
export function useConflicts(slots: Slot[], ignore?: (i: CalendarItem) => boolean) {
  const valid = slots.filter((s) => !isNaN(s.start.getTime()) && !isNaN(s.end.getTime()) && s.end > s.start);
  const lo = valid.length ? Math.min(...valid.map((s) => s.start.getTime())) : 0;
  const hi = valid.length ? Math.max(...valid.map((s) => s.end.getTime())) : 0;
  const res = useAsync(() => (valid.length ? api.calendar(new Date(lo).toISOString(), new Date(hi).toISOString()) : Promise.resolve([] as CalendarItem[])), [lo, hi]);
  const items = (res.data ?? []).filter((i) => !isAllDay(i.start_at, i.end_at) && i.status !== "cancelled" && !(ignore && ignore(i)));
  const clashes: Clash[] = [];
  for (const slot of valid) for (const item of items) {
    if (new Date(item.start_at) < slot.end && new Date(item.end_at) > slot.start) clashes.push({ slot, item });
  }
  // When something clashes, look a week ahead for the nearest gap of the same length inside waking hours.
  const [rest] = useRest();
  const first = clashes[0]?.slot;
  const len = first ? Math.round((first.end.getTime() - first.start.getTime()) / 60000) : 0;
  const day0 = first ? startOfDay(first.start) : null;
  const week = useAsync(() => (day0 ? api.calendar(day0.toISOString(), addDays(day0, 8).toISOString()) : Promise.resolve([] as CalendarItem[])), [day0?.getTime() ?? 0]);
  let next: Date | null = null;
  if (first && day0 && week.data) {
    const busy = week.data.filter((i) => !isAllDay(i.start_at, i.end_at) && i.status !== "cancelled" && !(ignore && ignore(i))).map((i) => ({ start: new Date(i.start_at).getTime(), end: new Date(i.end_at).getTime() }));
    for (let k = 0; k < 8 && !next; k++) {
      const at = freeSlot(busy, addDays(day0, k), len, { now: Date.now(), dayStartH: rest.before, dayEndH: rest.after });
      if (at !== null && at >= first.start.getTime() - 1) next = new Date(at);
    }
  }
  return { clashes, items, next, loading: res.loading ?? false };
}

/** The first gap of the same length at or after `slot.start`, on the same day. */
export function nextFree(items: CalendarItem[], slot: Slot): Date | null {
  const len = slot.end.getTime() - slot.start.getTime();
  let t = slot.start.getTime();
  const dayEnd = new Date(slot.start.getFullYear(), slot.start.getMonth(), slot.start.getDate() + 1).getTime();
  const sorted = [...items].sort((a, b) => a.start_at.localeCompare(b.start_at));
  for (let guard = 0; guard < 40; guard++) {
    const hit = sorted.find((i) => new Date(i.start_at).getTime() < t + len && new Date(i.end_at).getTime() > t);
    if (!hit) return t + len <= dayEnd ? new Date(t) : null;
    t = new Date(hit.end_at).getTime();
  }
  return null;
}

export function ConflictNote({ clashes, items, allow, setAllow, next, onUse }: { clashes: Clash[]; items: CalendarItem[]; allow: boolean; setAllow: (v: boolean) => void; next?: Date | null; onUse?: (start: Date) => void }) {
  if (clashes.length === 0) return null;
  const first = clashes[0], more = new Set(clashes.map((c) => c.slot.start.getTime())).size - 1;
  const free = next === undefined ? (clashes.length ? nextFree(items, first.slot) : null) : next;
  const mins = Math.round((first.slot.end.getTime() - first.slot.start.getTime()) / 60000);
  return (
    <div role="alert" className="space-y-1.5 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-sm">
      <p className="text-warn">
        You already have <span className="font-medium">{first.item.title}</span> on {dayShort(first.slot.start)}, {timeLabel(first.item.start_at)} – {timeLabel(first.item.end_at)}.
        {more > 0 && ` ${more} other ${more === 1 ? "time clashes" : "times clash"} too.`}
      </p>
      <p className="flex flex-wrap items-center gap-2 text-muted">
        {free ? <span>The nearest free {mins}-minute gap is {free.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}, {free.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</span> : <span>No free gap of that length in the next week. Try another time.</span>}
        {free && onUse && <button type="button" className="rounded-md border border-line2 px-2 py-0.5 text-xs text-ink hover:border-ink" onClick={() => onUse(free)}>Use this time</button>}
      </p>
      <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} /> I know. Keep both anyway</label>
    </div>
  );
}
