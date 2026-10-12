import { useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import { usePlanets } from "../planets";
import { Button, ErrorNote, Field, inputCls, Modal, NumInput } from "../components/ui";
import { TermsModal } from "../components/TermsModal";
import { CommitmentForm } from "../components/CommitmentForm";
import { EditBlock, EditCommitment, EditOccurrence } from "../components/EditForm";
import { RestModal } from "../components/RestModal";
import { splitOccurrence } from "../occurrence";
import { hourLabel, useRest } from "../settings";
import { addDays, dayLabel, isAllDay, mondayOf, sameDay, startOfDay, timeLabel, ymd } from "../lib";
import type { CalendarItem, Term } from "../types";

const PX = 44;   // the rest hours are shaded, never hidden
const dayDiff = (a: Date, b: Date) => Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);

/** Shown as a bar across days: all-day items, and anything timed that runs a day or longer across midnight. */
export const isBar = (i: CalendarItem) => isAllDay(i.start_at, i.end_at) || (new Date(i.end_at).getTime() - new Date(i.start_at).getTime() >= 18 * 3600000 && dayDiff(new Date(i.start_at), new Date(new Date(i.end_at).getTime() - 1)) !== 0);
/** All-day items clipped to a run of days, packed into lanes so they stack like Apple Calendar. */
function spans(items: CalendarItem[], first: Date, n: number) {
  const segs = items.filter(isBar).map((i) => {
    const s = dayDiff(new Date(i.start_at), first), e = isAllDay(i.start_at, i.end_at) ? dayDiff(new Date(i.end_at), first) : dayDiff(new Date(new Date(i.end_at).getTime() - 1), first) + 1;
    return { item: i, a: Math.max(0, s), b: Math.min(n, e), lead: s >= 0, tail: e <= n };
  }).filter((x) => x.b > x.a).sort((x, y) => x.a - y.a || y.b - y.a - (x.b - x.a));
  const lanes: number[] = [];
  const placed = segs.map((s) => { let l = lanes.findIndex((end) => end <= s.a); if (l < 0) l = lanes.length; lanes[l] = s.b; return { ...s, lane: l }; });
  return { segs: placed, lanes: lanes.length };
}
const holidayKey = (d: Date) => `orbit.holidays.${d.getFullYear()}-${d.getMonth() + 1}`;
function holidayDone(d: Date) { try { return localStorage.getItem(holidayKey(d)) === "1"; } catch { return false; } }
const periodOf = (d: Date, terms: Term[]) => terms.find((t) => t.start_date <= ymd(d) && ymd(d) <= t.end_date) ?? null;
const tint = (t: Term | null) => (t ? (t.kind === "term" ? "bg-term/[0.07]" : "bg-break/[0.10]") : "");

export default function Calendar({ rev, bump }: { rev: number; bump: () => void }) {
  const [view, setView] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [sel, setSel] = useState<CalendarItem | null>(null);
  const [terms, setTerms] = useState(false);
  const [full, setFull] = useState(false);
  const [creating, setCreating] = useState<{ start: Date; end: Date } | null>(null);
  const [editing, setEditing] = useState<CalendarItem | null>(null);
  const [drag, setDrag] = useState<{ day: string; a: number; b: number } | null>(null);
  const [rz, setRz] = useState<{ key: string; end: Date } | null>(null);
  const [moveErr, setMoveErr] = useState<string | null>(null);
  const [holiday, setHoliday] = useState(false);
  const [restOpen, setRestOpen] = useState(false);
  const [editingDay, setEditingDay] = useState<CalendarItem | null>(null);
  const [rest] = useRest();
  const REST_BEFORE = rest.before, REST_AFTER = rest.after;
  const [hDone, setHDone] = useState(() => holidayDone(new Date()));
  const { style } = usePlanets();
  const info = useAsync(() => api.terms(), [rev]);
  const tl = info.data?.terms ?? [];
  const cm = useAsync(() => api.commitments(), [rev]);
  const offIds = new Set((cm.data ?? []).filter((c) => c.time_off).map((c) => c.id));

  const weekStart = mondayOf(anchor);
  const monthFirst = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = mondayOf(monthFirst);
  const gridDays = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).filter((_, i, a) => i < 35 || a[35].getMonth() === monthFirst.getMonth());
  const [from, to] = view === "week" ? [weekStart, addDays(weekStart, 7)] : [gridStart, addDays(gridStart, gridDays.length)];
  const items = useAsync(() => api.calendar(from.toISOString(), to.toISOString()), [from.getTime(), to.getTime(), rev]);

  const step = (dir: -1 | 1) => setAnchor(view === "week" ? addDays(anchor, 7 * dir) : new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
  const title = view === "week" ? "Week" : monthFirst.toLocaleDateString([], { month: "long", year: "numeric" });
  const today = new Date();
  const all = items.data ?? [];
  const timed = all.filter((i) => !isBar(i));
  const startH = full ? 0 : Math.min(6, REST_BEFORE, ...timed.map((i) => new Date(i.start_at).getHours()));
  const endH = 24, rows = endH - startH;
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const monthWeeks = Array.from({ length: gridDays.length / 7 }, (_, w) => gridDays.slice(w * 7, w * 7 + 7));
  const breakItems: CalendarItem[] = tl.filter((t) => t.kind === "break").map((t) => ({
    kind: "fixed", commitment_id: "break:" + t.id, title: t.name, category: "other", planet_id: null, start_at: new Date(t.start_date + "T00:00").toISOString(),
    end_at: addDays(new Date(t.end_date + "T00:00"), 1).toISOString(), status: null, is_virtual: false, occurrence_date: null, time_block_id: null }));
  const isBreak = (i: CalendarItem) => i.commitment_id.startsWith("break:");
  const pick = (i: CalendarItem) => (isBreak(i) ? setTerms(true) : setSel(i));
  const isOff = (i: CalendarItem) => isBreak(i) || (offIds.has(i.commitment_id) && isAllDay(i.start_at, i.end_at));
  const barCls = (i: CalendarItem) => (isOff(i) ? "bg-break/70 text-ink ring-1 ring-inset ring-break" : style(i.planet_id, i.category).bar);
  const offDays = new Set<string>();
  for (const i of [...all, ...breakItems]) if (isOff(i)) for (let d = startOfDay(new Date(i.start_at)); d < new Date(i.end_at); d = addDays(d, 1)) offDays.add(ymd(d));
  const weekSpans = spans([...all, ...breakItems], weekStart, 7);
  const dayTint = (d: Date) => tint(periodOf(d, tl)) || (offDays.has(ymd(d)) ? "bg-break/[0.2]" : "");
  async function resizeOccurrence(i: CalendarItem, end: Date) {
    setMoveErr(null);
    try { await splitOccurrence(i, { start: new Date(i.start_at), end }); bump(); } catch (x) { setMoveErr((x as Error).message); }
  }
  const now = new Date(), showHoliday = now.getDate() <= 10 && !hDone;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <div className="flex rounded-full border border-line2 p-0.5 text-sm">
            {(["week", "month"] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-full px-3 py-0.5 ${view === v ? "bg-ink text-bg" : "text-muted"}`}>{v === "week" ? "Week" : "Month"}</button>)}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" onClick={() => step(-1)}>←</Button>
          <Button variant="ghost" onClick={() => setAnchor(new Date())}>Today</Button>
          <Button variant="ghost" onClick={() => step(1)}>→</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-term/40" /> Busy period</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-break/50" /> Time off (breaks and days off)</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-black/30" /> Rest hours (before {hourLabel(REST_BEFORE)}, after {hourLabel(REST_AFTER)}) <button className="underline decoration-dotted hover:text-ink" onClick={() => setRestOpen(true)}>Change</button></span>
        <span className="ml-auto flex gap-2">{view === "week" && <button className="rounded-full border border-line2 px-3 py-0.5 text-xs hover:border-ink hover:text-ink" onClick={() => setFull(!full)}>{full ? "Waking hours" : "Full 24 hours"}</button>}<button className="rounded-full border border-line2 px-3 py-0.5 text-xs hover:border-ink hover:text-ink" onClick={() => setTerms(true)}>Periods</button></span>
      </div>
      {info.data?.needs_input && info.data.message && (
        <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{info.data.message} <button className="underline" onClick={() => setTerms(true)}>Add dates</button></p>
      )}
      <ErrorNote msg={items.error ?? moveErr} />
      {showHoliday && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line2 bg-surface px-4 py-3 text-sm">
          <span className="text-muted">A new month. Are there any public holidays or days off coming up? Add them so Orbit plans around them.</span>
          <span className="flex gap-1">
            <button className="rounded-lg bg-ink px-3 py-1 text-bg" onClick={() => setHoliday(true)}>Add a day off</button>
            <button className="px-2 text-muted hover:text-ink" onClick={() => { try { localStorage.setItem(holidayKey(now), "1"); } catch { /* fine */ } setHDone(true); }}>None this month</button>
          </span>
        </div>
      )}

      {view === "week" ? (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <div className="grid min-w-[760px] grid-cols-[48px_repeat(7,1fr)]">
            <div />
            {weekDays.map((d) => (
              <div key={ymd(d)} className={`border-l border-line px-2 py-2 text-center text-xs font-medium ${dayTint(d)} ${sameDay(d, today) ? "text-ink" : "text-muted"}`}>
                <span className={sameDay(d, today) ? "rounded-full bg-sun/30 px-2 py-0.5" : ""}>{dayLabel(d)}</span>
              </div>
            ))}
            {weekSpans.segs.length > 0 && (<>
              <div className="pr-1 pt-1 text-right text-[10px] text-faint">all-day</div>
              <div className="col-span-7 grid grid-cols-7 gap-y-[3px] border-b border-l border-line px-0.5 py-1" style={{ gridAutoRows: "20px" }}>
                {weekSpans.segs.map((s) => (
                  <button key={s.item.commitment_id + s.item.start_at} onClick={() => pick(s.item)} title={s.item.title}
                    className={`truncate px-2 text-left text-[11px] font-medium leading-5 hover:brightness-110 ${barCls(s.item)} ${s.lead ? "rounded-l-md" : ""} ${s.tail ? "rounded-r-md" : ""} ${s.item.status === "completed" ? "opacity-50" : ""}`}
                    style={{ gridColumn: `${s.a + 1} / ${s.b + 1}`, gridRow: s.lane + 1 }}>{s.lead ? s.item.title : ""}</button>
                ))}
              </div>
            </>)}
            <div className="relative" style={{ height: rows * PX }}>
              {Array.from({ length: rows }, (_, i) => (
                <span key={i} className="absolute right-1 -translate-y-1/2 text-[10px] text-faint" style={{ top: i * PX }}>{i === 0 ? "" : `${startH + i}:00`}</span>
              ))}
            </div>
            {weekDays.map((d) => {
              const snapY = (e: React.PointerEvent<HTMLElement>) => Math.max(0, Math.min(rows * 60, Math.round(((e.clientY - e.currentTarget.getBoundingClientRect().top) / PX) * 60 / 15) * 15));
              const dayItems = timed.filter((i) => sameDay(new Date(i.start_at), d));
              return (
                <div key={ymd(d)} className={`relative select-none border-l border-line ${dayTint(d)}`} data-col style={{ height: rows * PX }}
                  onPointerDown={(e) => { if (e.target !== e.currentTarget || e.pointerType === "touch") return; const y = snapY(e); e.currentTarget.setPointerCapture(e.pointerId); setDrag({ day: ymd(d), a: y, b: y }); }}
                  onPointerMove={(e) => { if (drag && drag.day === ymd(d)) setDrag({ ...drag, b: snapY(e) }); }}
                  onPointerUp={() => {
                    if (!drag || drag.day !== ymd(d)) return;
                    const lo = Math.min(drag.a, drag.b), hi = Math.max(drag.a, drag.b); setDrag(null);
                    if (hi - lo >= 15) setCreating({ start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, startH * 60 + lo), end: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, startH * 60 + hi) });
                    else setCreating({ start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, startH * 60 + lo), end: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, startH * 60 + lo + 60) });
                  }}
                  onPointerCancel={() => setDrag(null)}>
                  {startH < REST_BEFORE && <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/20" style={{ height: (REST_BEFORE - startH) * PX }} />}
                  <div className="pointer-events-none absolute inset-x-0 bg-black/20" style={{ top: (REST_AFTER - startH) * PX, height: (endH - REST_AFTER) * PX }} />
                  {Array.from({ length: rows }, (_, i) => <div key={i} className="absolute inset-x-0 border-t border-line" style={{ top: i * PX }} />)}
                  {drag && drag.day === ymd(d) && <div className="pointer-events-none absolute inset-x-0.5 rounded-md border border-ink/50 bg-ink/15" style={{ top: Math.min(drag.a, drag.b) / 60 * PX, height: Math.max(Math.abs(drag.b - drag.a) / 60 * PX, 4) }} />}
                  {dayItems.map((i) => {
                    const key = (i.time_block_id ?? i.commitment_id) + i.start_at;
                    const s = new Date(i.start_at), e = rz?.key === key ? rz.end : new Date(i.end_at);
                    const canResize = (i.kind === "fixed" || i.kind === "virtual_occurrence" || (i.kind === "time_block" && i.status === "planned")) && i.status !== "completed";
                    const top = Math.max(0, (s.getHours() + s.getMinutes() / 60 - startH) * PX);
                    const h = Math.max(20, Math.min(((e.getTime() - s.getTime()) / 3600000) * PX - 2, rows * PX - top));
                    return (
                      <button key={key} onClick={() => setSel(i)}
                        className={`absolute inset-x-0.5 overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight hover:brightness-95 ${style(i.planet_id, i.category).soft} ${i.kind === "time_block" ? "border-dashed" : ""} ${i.status === "completed" ? "opacity-60" : ""}`}
                        style={{ top, height: h }}>
                        <span className="block truncate font-semibold">{i.title}</span>
                        <span className="text-muted">{timeLabel(i.start_at)}{rz?.key === key ? ` – ${e.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</span>
                        {canResize && (
                          <span role="separator" aria-label="Drag to change the end time" title="Drag to change the end time" className="absolute inset-x-0 bottom-0 flex h-2.5 cursor-ns-resize touch-none items-end justify-center"
                            onClick={(ev) => ev.stopPropagation()}
                            onPointerDown={(ev) => { ev.stopPropagation(); ev.currentTarget.setPointerCapture(ev.pointerId); setRz({ key, end: new Date(i.end_at) }); }}
                            onPointerMove={(ev) => { if (rz?.key !== key) return; const col = (ev.currentTarget.closest("[data-col]") as HTMLElement).getBoundingClientRect(); const mins = Math.max(15, Math.round(((ev.clientY - col.top) / PX) * 60 / 15) * 15 + startH * 60); const n = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 0, Math.max(mins, s.getHours() * 60 + s.getMinutes() + 15)); setRz({ key, end: n }); }}
                            onPointerUp={async (ev) => {
                              ev.stopPropagation(); if (rz?.key !== key) return; const end = rz.end; setRz(null);
                              if (end.getTime() === new Date(i.end_at).getTime()) return;
                              setMoveErr(null);
                              try { if (i.kind === "time_block") await api.moveTimeBlock(i.commitment_id, i.time_block_id!, i.start_at, end.toISOString()); else if (i.kind === "virtual_occurrence") { await resizeOccurrence(i, end); return; } else await api.updateCommitment(i.commitment_id, { end_at: end.toISOString() }); bump(); }
                              catch (x) { setMoveErr((x as Error).message); }
                            }}>
                            <span className="mb-0.5 h-0.5 w-6 rounded bg-ink/30" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="grid grid-cols-7 border-b border-line text-center text-xs text-muted">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          {monthWeeks.map((wk) => {
            const sp = spans([...all, ...breakItems], wk[0], 7);
            const pad = sp.lanes * 21;
            return (
              <div key={ymd(wk[0])} className="relative grid grid-cols-7">
                {wk.map((d) => {
                  const inMonth = d.getMonth() === monthFirst.getMonth();
                  const its = timed.filter((i) => sameDay(new Date(i.start_at), d));
                  return (
                    <button key={ymd(d)} onClick={() => { setAnchor(d); setView("week"); }}
                      className={`flex min-h-[84px] flex-col items-start justify-start border-b border-r border-line p-1.5 text-left align-top hover:brightness-110 ${dayTint(d)} ${inMonth ? "" : "opacity-40"}`}>
                      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${sameDay(d, today) ? "bg-sun/30 text-ink" : "text-muted"}`}>{d.getDate()}</span>
                      <span className="mt-1 block space-y-0.5" style={{ paddingTop: pad }}>
                        {its.slice(0, 3).map((i) => (
                          <span key={(i.time_block_id ?? i.commitment_id) + i.start_at} className="flex items-center gap-1 text-[10px] leading-tight">
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style(i.planet_id, i.category).dot}`} /><span className="truncate">{i.title}</span>
                          </span>
                        ))}
                        {its.length > 3 && <span className="block text-[10px] text-faint">+{its.length - 3} more</span>}
                      </span>
                    </button>
                  );
                })}
                {sp.segs.length > 0 && (
                  <div className="pointer-events-none absolute inset-x-0 top-[30px] grid grid-cols-7 gap-y-[3px] px-0.5" style={{ gridAutoRows: "18px" }}>
                    {sp.segs.map((s) => (
                      <button key={s.item.commitment_id + s.item.start_at} onClick={() => pick(s.item)} title={s.item.title}
                        className={`pointer-events-auto truncate px-1.5 text-left text-[10px] font-medium leading-[18px] hover:brightness-110 ${barCls(s.item)} ${s.lead ? "rounded-l-md" : ""} ${s.tail ? "rounded-r-md" : ""} ${s.item.status === "completed" ? "opacity-50" : ""}`}
                        style={{ gridColumn: `${s.a + 1} / ${s.b + 1}`, gridRow: s.lane + 1 }}>{s.lead || s.a === 0 ? s.item.title : ""}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted">Solid blocks are fixed commitments. Dashed blocks are time you planned for flexible work. Drag on an empty space to add something, drag the bottom edge of a block to change its end, or click a block to edit it.</p>

      {holiday && <HolidayModal onClose={() => setHoliday(false)} onDone={() => { try { localStorage.setItem(holidayKey(new Date()), "1"); } catch { /* fine */ } setHDone(true); bump(); }} />}
      {creating && <CommitmentForm initial={creating} onClose={() => setCreating(null)} onDone={bump} />}
      {editing && (editing.kind === "time_block" ? <EditBlock item={editing} onClose={() => setEditing(null)} onDone={bump} /> : <EditCommitment id={editing.commitment_id} onClose={() => setEditing(null)} onDone={bump} />)}
      {sel && <ItemDialog item={sel} onClose={() => setSel(null)} onDone={bump} onEdit={() => { setEditing(sel); setSel(null); }} onEditDay={() => { setEditingDay(sel); setSel(null); }} />}
      {editingDay && <EditOccurrence item={editingDay} onClose={() => setEditingDay(null)} onDone={bump} />}
      {restOpen && <RestModal onClose={() => setRestOpen(false)} />}
      {terms && <TermsModal onClose={() => setTerms(false)} onDone={() => { info.reload(); bump(); }} />}
    </div>
  );
}

function ItemDialog({ item, onClose, onDone, onEdit, onEditDay }: { item: CalendarItem; onClose: () => void; onDone: () => void; onEdit: () => void; onEditDay: () => void }) {
  const { style } = usePlanets();
  const planned = item.kind === "time_block" && item.status === "planned";
  const mins = Math.round((new Date(item.end_at).getTime() - new Date(item.start_at).getTime()) / 60000);
  const [actual, setActual] = useState(mins);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setErr(null);
    try { await fn(); onDone(); onClose(); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <Modal title={item.title} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-muted">
          {isAllDay(item.start_at, item.end_at) && addDays(new Date(item.end_at), -1) > new Date(item.start_at)
            ? `${new Date(item.start_at).toLocaleDateString([], { day: "numeric", month: "long" })} to ${addDays(new Date(item.end_at), -1).toLocaleDateString([], { day: "numeric", month: "long" })}`
            : new Date(item.start_at).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}<br />
          {isAllDay(item.start_at, item.end_at) ? "All day" : `${timeLabel(item.start_at)} – ${timeLabel(item.end_at)}`} · {style(item.planet_id, item.category).label}
          {item.is_virtual && <span className="ml-2 rounded bg-surface2 px-1.5 py-0.5 text-xs">repeats</span>}
        </p>
        <ErrorNote msg={err} />
        {item.status !== "completed" && !(item.kind === "time_block" && item.status !== "planned") && <div className="flex flex-wrap gap-2">
          {item.kind === "virtual_occurrence" && <Button variant="ghost" className="border border-line2" onClick={onEditDay}>Edit just this day</Button>}
          <Button variant="ghost" className="border border-line2" onClick={onEdit}>{item.is_virtual ? "Edit every repeat" : "Edit"}</Button>
        </div>}
        {item.kind === "virtual_occurrence" && item.occurrence_date && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run(() => api.attendOccurrence(item.commitment_id, item.occurrence_date!))}>Mark attended</Button>
            <Button variant="danger" onClick={() => run(() => api.cancelOccurrence(item.commitment_id, item.occurrence_date!))}>Cancel just this day</Button>
          </div>
        )}
        {item.kind === "fixed" && item.status !== "completed" && (
          <Button onClick={() => run(() => api.completeCommitment(item.commitment_id))}>Mark done</Button>
        )}
        {planned && (
          <div className="space-y-2">
            <Field label="Minutes you actually worked"><NumInput min={0} value={actual} onChange={setActual} /></Field>
            <Button onClick={() => run(() => api.completeTimeBlock(item.commitment_id, item.time_block_id!, actual))}>Complete block</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function HolidayModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { planets } = usePlanets();
  const [name, setName] = useState("Public holiday");
  const [from, setFrom] = useState(ymd(new Date()));
  const [to, setTo] = useState(ymd(new Date()));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const planet = planets.find((p) => p.kind === "other") ?? planets.find((p) => p.kind === "personal") ?? planets[0];
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      if (!planet) throw new Error("Create a planet first.");
      const a = new Date(from + "T00:00"), b = addDays(new Date(to + "T00:00"), 1);
      if (b <= a) throw new Error("The last day is before the first day.");
      await api.createCommitment({ mode: "fixed", title: name, planet_id: planet.id, start_at: a.toISOString(), end_at: b.toISOString(), time_off: true });
      onDone(); onClose();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal title="Add a day off" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <Field label="What is it?"><input required autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day"><input type="date" required className={inputCls} value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></Field>
          <Field label="Last day"><input type="date" required className={inputCls} min={from} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-muted">It shows as a highlighted banner across those days. For more, use New commitment, then Fixed, then All day.</p>
        <ErrorNote msg={err} />
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy}>Add</Button></div>
      </form>
    </Modal>
  );
}
