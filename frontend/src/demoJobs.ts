import type { Job } from "./types";

/** The preview's jobs. "Your hourly rate" everywhere comes from the main job, never a fixed number. */
export const jobList: Job[] = [{ id: "job-1", name: "Part-time (F&B)", hourly_rate: 11, pay_basis: "hourly", monthly_pay: null, unpaid_break_minutes: 60, break_after_minutes: 480, is_main: true }];

export function mainRateCents(): number | null {
  const paid = (j: Job) => j.pay_basis === "hourly" && (j.hourly_rate ?? 0) > 0;
  const main = jobList.find((j) => j.is_main && paid(j));
  const pick = main ?? jobList.filter(paid).sort((a, b) => (b.hourly_rate ?? 0) - (a.hourly_rate ?? 0))[0];
  return pick ? Math.round((pick.hourly_rate ?? 0) * 100) : null;
}
