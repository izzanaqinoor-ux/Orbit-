import { useState } from "react";
import { FEATURES, STARTS, usePrefs } from "../prefs";
import type { FeatureKey } from "../types";
import { Button, ErrorNote } from "./ui";

/** "Your world revolves around you": the person ticks what belongs in theirs. Hidden is never deleted. */
export function MakeOrbitYours({ first, onClose }: { first: boolean; onClose: () => void }) {
  const { features, save } = usePrefs();
  const [f, setF] = useState(features);
  const [start, setStart] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = (id: string) => { setStart(id); setF({ ...STARTS.find((s) => s.id === id)!.features }); };
  const flip = (k: FeatureKey) => { setStart(null); setF((x) => ({ ...x, [k]: !x[k] })); };
  const done = async () => { setBusy(true); setErr(null); try { await save(f); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  const body = (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="mb-1 text-xs uppercase tracking-[0.18em] text-faint">{first ? "Welcome" : "Settings"}</p>
        <h1 className="text-3xl tracking-tight">Make Orbit yours</h1>
        <p className="mt-2 text-muted">Your world revolves around you, so only keep what belongs in it. Tick what you want. Anything you leave out is hidden, never deleted, and you can change your mind whenever you like.</p>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-muted">Start from</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {STARTS.map((s) => (
            <button key={s.id} onClick={() => pick(s.id)} className={`rounded-xl border px-3 py-3 text-left ${start === s.id ? "border-ink bg-surface2" : "border-line hover:border-line2"}`}>
              <span className="block font-medium">{s.label}</span><span className="text-xs text-muted">{s.line}</span>
            </button>))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-muted">What belongs in your Orbit</p>
        <ul className="divide-y divide-line rounded-xl border border-line">
          {FEATURES.map((x) => {
            const blocked = !!x.needs && !f[x.needs];
            return (
              <li key={x.key} className={blocked ? "opacity-45" : ""}>
                <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-sun" checked={f[x.key] && !blocked} disabled={blocked} onChange={() => flip(x.key)} />
                  <span><span className="block">{x.label}</span><span className="text-sm text-muted">{x.desc}{blocked ? " (turn on Money first)" : ""}</span></span>
                </label>
              </li>);
          })}
        </ul>
      </div>
      <ErrorNote msg={err} />
      <div className="flex justify-end gap-2">
        {!first && <Button variant="ghost" onClick={onClose}>Cancel</Button>}
        <Button disabled={busy} onClick={done}>{busy ? "Saving…" : first ? "Open my Orbit" : "Save"}</Button>
      </div>
    </div>
  );
  if (first) return <div className="mx-auto min-h-screen max-w-5xl px-4 py-10">{body}</div>;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-bg/95 px-4 py-10" onKeyDown={(e) => e.key === "Escape" && onClose()}>{body}</div>
  );
}
