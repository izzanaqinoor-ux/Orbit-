import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { PSTYLE } from "./lib";
import { usePrefs } from "./prefs";
import type { Category, Planet, PlanetColor } from "./types";

interface Ctx {
  planets: Planet[];
  refresh: () => Promise<void>;
  style: (planetId: string | null | undefined, kind: Category) => { dot: string; soft: string; text: string; bar: string; label: string; color: PlanetColor };
}
const KIND_COLOR: Record<Category, PlanetColor> = { study: "study", work: "work", personal: "personal", other: "other" };
const KIND_LABEL: Record<Category, string> = { study: "Study", work: "Work", personal: "Personal", other: "Other" };
const PlanetsCtx = createContext<Ctx>({ planets: [], refresh: async () => {}, style: (_p, k) => ({ ...PSTYLE[KIND_COLOR[k]], label: KIND_LABEL[k], color: KIND_COLOR[k] }) });

export function PlanetsProvider({ children }: { children: ReactNode }) {
  const { on } = usePrefs();
  const [all, setAll] = useState<Planet[]>([]);
  const studyOn = on("study");
  const planets = useMemo(() => (studyOn ? all : all.filter((p) => p.kind !== "study")), [all, studyOn]);
  const refresh = useCallback(async () => { try { setAll(await api.planets()); } catch { /* shown elsewhere */ } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const value = useMemo<Ctx>(() => ({
    planets, refresh,
    style: (id, kind) => {
      const p = id ? planets.find((x) => x.id === id) : undefined;
      const color = p?.color ?? KIND_COLOR[kind];
      return { ...PSTYLE[color], label: p?.name ?? KIND_LABEL[kind], color };
    },
  }), [planets, refresh]);
  return <PlanetsCtx.Provider value={value}>{children}</PlanetsCtx.Provider>;
}
export const usePlanets = () => useContext(PlanetsCtx);
