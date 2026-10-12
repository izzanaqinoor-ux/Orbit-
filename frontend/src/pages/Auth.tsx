import { useState } from "react";
import { api } from "../api";
import { Button, ErrorNote, Field, inputCls } from "../components/ui";

export default function Auth({ onAuthed }: { onAuthed: () => void }) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await (register ? api.register(email, password) : api.login(email, password)); onAuthed(); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-sun/25"><div className="h-7 w-7 rounded-full bg-sun" /></div>
        <h1 className="text-3xl font-semibold tracking-tight">Orbit</h1>
        <p className="mt-1 text-sm text-muted">Your time, with you at the centre.</p>
      </div>
      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-line bg-surface p-5">
        <Field label="Email"><input type="email" required autoComplete="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input type="password" required minLength={8} autoComplete={register ? "new-password" : "current-password"} className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <ErrorNote msg={err} />
        <Button className="w-full" disabled={busy}>{register ? "Create account" : "Sign in"}</Button>
      </form>
      <button className="mt-4 text-sm text-muted hover:text-ink" onClick={() => setRegister(!register)}>
        {register ? "Already have an account? Sign in" : "New here? Create an account"}
      </button>
      {import.meta.env.VITE_DEMO && <p className="mt-6 text-center text-xs text-faint">Preview mode — any email and password works, and nothing is saved.</p>}
    </div>
  );
}
