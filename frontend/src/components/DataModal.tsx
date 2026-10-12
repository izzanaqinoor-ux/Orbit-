import { useState } from "react";
import { api } from "../api";
import { Button, ErrorNote, Modal } from "./ui";

export function DataModal({ onClose }: { onClose: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (k: "json" | "csv") => { setErr(null); setBusy(k); try { await api.exportData(k); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); } };
  return (
    <Modal title="Your data" onClose={onClose}>
      <p className="mb-4 text-sm text-muted">It's yours. Download everything Orbit holds about you, any time. Your password is never included.</p>
      <div className="space-y-3">
        <div className="rounded-xl bg-surface2 p-3"><p className="font-medium">Everything (JSON)</p><p className="mb-2 text-xs text-muted">Commitments, planets, finance, rules, history. Good as a backup.</p><Button disabled={busy !== null} onClick={() => go("json")}>{busy === "json" ? "Preparing…" : "Download JSON"}</Button></div>
        <div className="rounded-xl bg-surface2 p-3"><p className="font-medium">Money entries (CSV)</p><p className="mb-2 text-xs text-muted">Every income, expense and transfer. Opens in Excel or Sheets.</p><Button disabled={busy !== null} onClick={() => go("csv")}>{busy === "csv" ? "Preparing…" : "Download CSV"}</Button></div>
      </div>
      <div className="mt-3"><ErrorNote msg={err} /></div>
    </Modal>
  );
}
