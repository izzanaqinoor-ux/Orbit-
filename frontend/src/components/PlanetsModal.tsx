import { useState } from "react";
import { api } from "../api";
import { usePlanets } from "../planets";
import { PSTYLE } from "../lib";
import { PLANET_COLORS, type Category, type PlanetColor } from "../types";
import { useOrbitLines, type Lines } from "../settings";
import { Button, ErrorNote, Field, inputCls, Modal } from "./ui";

const KINDS: [Category, string, string][] = [
  ["study", "Study-like", "classes, assignments, exams"], ["work", "Work-like", "shifts and job tasks"],
  ["personal", "Personal", "hobbies, errands, health"], ["other", "Other", "anything else"],
];

export function PlanetsModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { planets, refresh } = usePlanets();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Category>("personal");
  const [color, setColor] = useState<PlanetColor>("violet");
  const [err, setErr] = useState<string | null>(null);
  const [lines, setLines] = useOrbitLines();

  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); await refresh(); onDone(); } catch (e) { setErr((e as Error).message); } };

  return (
    <Modal title="Your planets" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">Each planet is a part of your life. Make as many as you like — a hobby, a society, a side project — and remove one when it's no longer in use.</p>
        <ErrorNote msg={err} />
        <ul className="divide-y divide-line">
          {planets.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <span className={`h-3 w-3 shrink-0 rounded-full ${PSTYLE[p.color].dot}`} />
              <span className="flex-1 truncate">{p.name}</span>
              <span className="text-xs text-faint">{p.kind}</span>
              <button className="text-faint hover:text-neg" onClick={() => run(() => api.deletePlanet(p.id))}>Delete</button>
            </li>
          ))}
        </ul>
        <form className="space-y-3 rounded-xl bg-surface2 p-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) run(async () => { await api.addPlanet(name.trim(), kind, color); setName(""); }); }}>
          <Field label="New planet"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Cello, Society, Side project…" /></Field>
          <Field label="Behaves like">
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as Category)}>{KINDS.map(([k, l, h]) => <option key={k} value={k}>{l} — {h}</option>)}</select>
          </Field>
          <div>
            <span className="mb-1 block font-medium text-muted">Colour</span>
            <div className="flex flex-wrap gap-2">
              {PLANET_COLORS.map((c) => (
                <button type="button" key={c} aria-label={c} onClick={() => setColor(c)} className={`h-6 w-6 rounded-full ${PSTYLE[c].dot} ${color === c ? "ring-2 ring-ink ring-offset-2 ring-offset-surface2" : ""}`} />
              ))}
            </div>
          </div>
          <Button type="submit">Add planet</Button>
        </form>
        <div>
          <span className="mb-1 block font-medium text-muted">Orbit lines on the Orbit page</span>
          <div className="flex gap-2">
            {([["soft", "Soft", "Rings fade with distance"], ["even", "Even", "Uniform fine lines"]] as [Lines, string, string][]).map(([k, l, h]) => (
              <button type="button" key={k} onClick={() => setLines(k)} aria-pressed={lines === k} className={`flex-1 rounded-lg border px-3 py-2 text-left ${lines === k ? "border-ink bg-surface2" : "border-line text-muted"}`}>
                <span className="block font-medium">{l}</span><span className="text-xs">{h}</span>
              </button>))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
