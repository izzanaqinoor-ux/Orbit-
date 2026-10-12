import { useState } from "react";
import { Button, Field, inputCls, Modal } from "./ui";
import { hourLabel, useRest } from "../settings";

/** Which hours count as rest. They are shaded on the calendar and nothing is planned into them automatically. */
export function RestModal({ onClose }: { onClose: () => void }) {
  const [rest, setRest] = useRest();
  const [before, setBefore] = useState(rest.before);
  const [after, setAfter] = useState(rest.after);
  const bad = before >= after;
  return (
    <Modal title="Your rest hours" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-muted">Orbit shades these hours on the calendar and keeps automatic planning (Study plans, suggested times) inside the hours between. You can still put anything anywhere yourself.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Your day starts"><select className={inputCls} value={before} onChange={(e) => setBefore(+e.target.value)}>{Array.from({ length: 13 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select></Field>
          <Field label="Your day ends"><select className={inputCls} value={after} onChange={(e) => setAfter(+e.target.value)}>{Array.from({ length: 13 }, (_, i) => 12 + i).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select></Field>
        </div>
        {bad && <p className="text-neg">The day has to end after it starts.</p>}
        <p className="text-xs text-faint">Saved on this device.</p>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={bad} onClick={() => { setRest({ before, after }); onClose(); }}>Save</Button></div>
      </div>
    </Modal>
  );
}
