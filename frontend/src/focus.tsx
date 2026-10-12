import { createContext, useContext, type ReactNode } from "react";
import { api } from "./api";
import { useAsync } from "./hooks";
import { usePrefs } from "./prefs";
import type { ExamFocus } from "./types";

const Ctx = createContext<ExamFocus | null>(null);

/** When an exam is close, the app goes quiet about money and points at study time. */
export function FocusProvider({ rev, children }: { rev: number; children: ReactNode }) {
  const { on } = usePrefs();
  const f = useAsync(() => (on("study") ? api.examFocus() : Promise.resolve(null)), [rev, on("study")]);
  return <Ctx.Provider value={on("study") ? f.data : null}>{children}</Ctx.Provider>;
}
export const useFocus = () => useContext(Ctx);
