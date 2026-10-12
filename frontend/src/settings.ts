import { useCallback, useEffect, useState } from "react";

/** Small per-device settings kept in the browser. They never need to leave this device. */
function useLocal<T>(key: string, fallback: T, valid: (v: unknown) => v is T): [T, (v: T) => void] {
  const read = useCallback((): T => { try { const raw = localStorage.getItem(key); if (raw !== null) { const v = JSON.parse(raw); if (valid(v)) return v; } } catch { /* fall back */ } return fallback; }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [v, setV] = useState<T>(read);
  useEffect(() => { const h = () => setV(read()); window.addEventListener("orbit:setting", h); return () => window.removeEventListener("orbit:setting", h); }, [read]);
  const set = useCallback((n: T) => { setV(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* optional */ } window.dispatchEvent(new Event("orbit:setting")); }, [key]);
  return [v, set];
}

export interface Rest { before: number; after: number }
const isRest = (v: unknown): v is Rest => !!v && typeof v === "object" && Number.isInteger((v as Rest).before) && Number.isInteger((v as Rest).after) && (v as Rest).before >= 0 && (v as Rest).after <= 24 && (v as Rest).before < (v as Rest).after;
/** Hours you treat as rest: nothing is planned before `before` or after `after`. */
export const useRest = () => useLocal<Rest>("orbit.rest", { before: 8, after: 22 }, isRest);
export const hourLabel = (h: number) => (h === 0 || h === 24 ? "midnight" : h === 12 ? "12 noon" : h < 12 ? `${h} am` : `${h - 12} pm`);

export type Lines = "soft" | "even";
const isLines = (v: unknown): v is Lines => v === "soft" || v === "even";
export const useOrbitLines = () => useLocal<Lines>("orbit.lines2", "soft", isLines);
