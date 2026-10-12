import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { FeatureKey, Prefs } from "./types";

export const FEATURES: { key: FeatureKey; label: string; desc: string; needs?: FeatureKey }[] = [
  { key: "study", label: "Study & exams", desc: "Classes, hand-ins and exams, with quiet time before an exam." },
  { key: "work", label: "Work & pay", desc: "Jobs, shifts, hours worked and what they pay." },
  { key: "finance", label: "Money", desc: "Spending, savings, goals and a monthly statement that tallies." },
  { key: "investing", label: "Investing", desc: "Portfolio, a monthly value check-in and a net-worth roadmap.", needs: "finance" },
  { key: "planning", label: "Can I afford it?", desc: "Check a purchase against your own rules, with a wishlist.", needs: "finance" },
  { key: "import", label: "Bank statement import", desc: "Bring in CSV statements from one or more accounts.", needs: "finance" },
  { key: "occasions", label: "Special occasions", desc: "Birthdays, dinners and other rare dates, kept in view." },
  { key: "review", label: "Weekly review", desc: "A plain look back at your week, any time you want it." },
];

const set = (...on: FeatureKey[]): Record<FeatureKey, boolean> =>
  Object.fromEntries(FEATURES.map((f) => [f.key, on.includes(f.key)])) as Record<FeatureKey, boolean>;

export const STARTS: { id: string; label: string; line: string; features: Record<FeatureKey, boolean> }[] = [
  { id: "student", label: "Student", line: "Classes, exams, a part-time job and a tight budget.", features: set("study", "work", "finance", "planning", "occasions", "review") },
  { id: "worker", label: "Office worker", line: "A job, bills, savings goals and maybe investing.", features: set("work", "finance", "investing", "planning", "import", "occasions", "review") },
  { id: "all", label: "Everything", line: "Start with it all on and hide what you don't need.", features: set("study", "work", "finance", "investing", "planning", "import", "occasions", "review") },
];

interface Ctx { loaded: boolean; onboarded: boolean; features: Record<FeatureKey, boolean>; on: (k: FeatureKey) => boolean; save: (f: Record<FeatureKey, boolean>) => Promise<void> }
const all = set(...FEATURES.map((f) => f.key));
const PrefsCtx = createContext<Ctx>({ loaded: false, onboarded: true, features: all, on: () => true, save: async () => {} });

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState<Prefs | null>(null);
  useEffect(() => { api.preferences().then(setP).catch(() => setP({ features: all, onboarded: true })); }, []);
  const save = useCallback(async (features: Record<FeatureKey, boolean>) => { setP(await api.setPreferences({ features, onboarded: true })); }, []);
  const value = useMemo<Ctx>(() => {
    const f = p?.features ?? all;
    return { loaded: p !== null, onboarded: p?.onboarded ?? true, features: f, save,
      on: (k) => { const need = FEATURES.find((x) => x.key === k)?.needs; return f[k] && (!need || f[need]); } };
  }, [p, save]);
  return <PrefsCtx.Provider value={value}>{children}</PrefsCtx.Provider>;
}
export const usePrefs = () => useContext(PrefsCtx);
