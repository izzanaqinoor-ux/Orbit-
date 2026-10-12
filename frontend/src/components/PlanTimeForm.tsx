import { useState } from "react";
import { api } from "../api";
import { Button, ErrorNote, Field, inputCls, Modal, NumInput } from "./ui";
import { toLocalInput, localInputToISO } from "../lib";
import { ConflictNote, useConflicts } from "./Conflicts";

export function PlanTimeForm({ commitmentId, title, defaultMinutes, onClose, onDone }: {
  commitmentId: string; title: string; defaultMinutes: number; onClose: () => void; onDone: () => void;
}) {
  const next = new Date(); next.setHours(next.getHours() + 1, 0, 0, 0);
  const [start, setStart] = useState(toLocalInput(next));
  const [mins, setMins] = useState(Math.min(Math.max(defaultMinutes, 15), 180));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [allow, setAllow] = useState(false);
  const s0 = new Date(start);
  const { clashes, items, next: gap } = useConflicts([{ start: s0, end: new Date(s0.getTime() + Math.max(mins, 1) * 60000) }]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const s = new Date(localInputToISO(start));
      await api.addTimeBlock(commitmentId, s.toISOString(), new Date(s.getTime() + mins * 60000).toISOString());
      onDone(); onClose();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal title="Plan time" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted">{title}</p>
        <Field label="Starts"><input type="datetime-local" required className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Length (minutes)"><NumInput min={5} step={5} required value={mins} onChange={setMins} /></Field>
        <ConflictNote clashes={clashes} items={items} allow={allow} setAllow={setAllow} next={gap} onUse={(d) => setStart(toLocalInput(d))} />
        <ErrorNote msg={err} />
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || (clashes.length > 0 && !allow)}>Add block</Button></div>
      </form>
    </Modal>
  );
}
