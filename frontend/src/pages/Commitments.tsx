import { useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import { Button, Card, ErrorNote } from "../components/ui";
import { CommitmentForm } from "../components/CommitmentForm";
import { PlanTimeForm } from "../components/PlanTimeForm";
import { dueLabel, hours } from "../lib";
import { usePlanets } from "../planets";
import { EditCommitment } from "../components/EditForm";
import { PlanetsModal } from "../components/PlanetsModal";
import type { Commitment } from "../types";

function when(c: Commitment) {
  if (c.mode === "flexible") {
    return `${hours(c.estimated_duration_minutes ?? 0)} of effort${c.due_at ? ` · due ${dueLabel(c.due_at, c.due_all_day)}` : ""}`;
  }
  const s = new Date(c.start_at!), e = new Date(c.end_at!);
  const t = `${s.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – ${e.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  if (c.recurrence_rule) {
    const r = c.recurrence_rule;
    return `${r.interval > 1 ? `every ${r.interval} weeks` : "weekly"} on ${r.days.map((d) => d[0] + d.slice(1).toLowerCase()).join(", ")} · ${t}`;
  }
  return `${s.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} · ${t}`;
}

export default function Commitments({ rev, bump }: { rev: number; bump: () => void }) {
  const list = useAsync(() => api.commitments(), [rev]);
  const { style } = usePlanets();
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const [plan, setPlan] = useState<Commitment | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const all = (list.data ?? []).filter((c) => !c.recurrence_template_id);
  const live = all.filter((c) => ["todo", "in_progress"].includes(c.status));
  const sections: [string, Commitment[]][] = [
    ["Flexible work", live.filter((c) => c.mode === "flexible")],
    ["Fixed & recurring", live.filter((c) => c.mode === "fixed")],
    ["Finished", all.filter((c) => ["completed", "skipped"].includes(c.status))],
  ];

  async function act(fn: () => Promise<void>) {
    setErr(null);
    try { await fn(); bump(); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Commitments</h1>
        <div className="flex gap-2"><Button variant="ghost" onClick={() => setManaging(true)}>Planets</Button><Button onClick={() => setCreating(true)}>+ New</Button></div>
      </div>
      <ErrorNote msg={err ?? list.error} />
      {sections.map(([name, rows]) => (
        <Card key={name}>
          <h2 className="mb-2 font-semibold">{name} <span className="font-normal text-faint">{rows.length}</span></h2>
          {rows.length === 0 ? <p className="text-sm text-muted">Nothing here.</p> : (
            <ul className="divide-y divide-line">
              {rows.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style(c.planet_id, c.category).dot}`} />
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-medium ${c.status === "completed" ? "text-faint line-through" : ""}`}>{c.title}</p>
                      <p className="text-xs text-muted">{when(c)}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {["todo", "in_progress"].includes(c.status) && <Button variant="ghost" onClick={() => setEdit(c.id)}>Edit</Button>}
                    {c.mode === "flexible" && c.status !== "completed" && <Button variant="ghost" onClick={() => setPlan(c)}>Plan time</Button>}
                    {!c.recurrence_rule && c.status !== "completed" && c.status !== "skipped" && <Button variant="ghost" onClick={() => act(() => api.completeCommitment(c.id))}>Done</Button>}
                    {["todo", "in_progress"].includes(c.status) && <Button variant="danger" onClick={() => act(() => api.archiveCommitment(c.id))}>Archive</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
      {managing && <PlanetsModal onClose={() => setManaging(false)} onDone={bump} />}
      {creating && <CommitmentForm onClose={() => setCreating(false)} onDone={bump} />}
      {edit && <EditCommitment id={edit} onClose={() => setEdit(null)} onDone={bump} />}
      {plan && <PlanTimeForm commitmentId={plan.id} title={plan.title} defaultMinutes={60} onClose={() => setPlan(null)} onDone={bump} />}
    </div>
  );
}
