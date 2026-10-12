import { api } from "./api";
import type { CalendarItem } from "./types";

/**
 * Change one day of a repeating event without touching the others: the day is cancelled in the series and a one-off
 * event takes its place (same title, planet, notes and job unless you change them).
 */
export async function splitOccurrence(item: CalendarItem, to: { start: Date; end: Date; title?: string }): Promise<void> {
  if (!item.occurrence_date) throw new Error("This isn't a repeat.");
  if (to.end <= to.start) throw new Error("The end must be after the start.");
  const t = (await api.commitments()).find((c) => c.id === item.commitment_id);
  const planet = item.planet_id ?? t?.planet_id;
  if (!t || !planet) throw new Error("Couldn't find the repeating event.");
  const one = await api.createCommitment({ mode: "fixed", title: (to.title ?? t.title).trim() || t.title, planet_id: planet, start_at: to.start.toISOString(), end_at: to.end.toISOString(), description: t.description });
  const job = await api.shiftJob(t.id);
  if (job) { try { await api.setShiftJob(one.id, job); } catch { /* optional */ } }
  await api.cancelOccurrence(item.commitment_id, item.occurrence_date);
}
