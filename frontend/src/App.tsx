import { useEffect, useState } from "react";
import { api } from "./api";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Space from "./pages/Space";
import Calendar from "./pages/Calendar";
import Study from "./pages/Study";
import Commitments from "./pages/Commitments";
import Finance from "./pages/Finance";
import { PlanetsProvider } from "./planets";
import { TermsModal } from "./components/TermsModal";
import { ValuationModal } from "./components/ValuationModal";
import { useAsync } from "./hooks";
import { where } from "./lib";
import { FocusProvider, useFocus } from "./focus";
import { PrefsProvider, usePrefs } from "./prefs";
import { MakeOrbitYours } from "./components/MakeOrbitYours";
import { NotesButton } from "./components/NotesButton";
import { AccountMenu } from "./components/AccountMenu";
import { DataModal } from "./components/DataModal";

type Tab = "dashboard" | "orbit" | "calendar" | "study" | "commitments" | "finance";
const ALL_TABS: [Tab, string][] = [["orbit", "Orbit"], ["dashboard", "This week"], ["calendar", "Calendar"], ["study", "Study"], ["commitments", "Commitments"], ["finance", "Finance"]];

function TermReminder({ rev, bump }: { rev: number; bump: () => void }) {
  const focus = useFocus();
  const { on } = usePrefs();
  const info = useAsync(() => api.terms(), [rev]);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (!on("study") || focus?.active || hidden || !info.data?.needs_input || !info.data.message) return open ? <TermsModal onClose={() => setOpen(false)} onDone={bump} /> : null;
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line2 bg-surface px-4 py-3 text-sm">
        <span className="text-muted">{info.data.message}</span>
        <span className="flex gap-1"><button className="rounded-lg bg-ink px-3 py-1 text-bg" onClick={() => setOpen(true)}>Add dates</button><button className="px-2 text-faint hover:text-ink" onClick={() => setHidden(true)} aria-label="Dismiss">✕</button></span>
      </div>
      {open && <TermsModal onClose={() => setOpen(false)} onDone={bump} />}
    </>
  );
}

function ValuationReminder({ rev, bump }: { rev: number; bump: () => void }) {
  const focus = useFocus();
  const { on } = usePrefs();
  const v = useAsync(() => (on("investing") ? api.valuations() : Promise.resolve(null)), [rev, on("investing")]);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const today = new Date(), daysLeft = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate();
  const monthEnd = daysLeft <= 4;   // the last five days of the month, just before the next month's buying
  if (!open && (!on("investing") || focus?.active || hidden || !monthEnd || !v.data?.due)) return null;
  return (
    <>
      {!hidden && !focus?.active && monthEnd && v.data?.due && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line2 bg-surface px-4 py-3 text-sm">
          <span className="text-muted">Month-end check-in: before you buy for next month, what are your investments worth today? It's only for your records.</span>
          <span className="flex gap-1"><button className="rounded-lg bg-ink px-3 py-1 text-bg" onClick={() => setOpen(true)}>Record values</button><button className="px-2 text-faint hover:text-ink" onClick={() => setHidden(true)} aria-label="Dismiss">✕</button></span>
        </div>)}
      {open && <ValuationModal onClose={() => setOpen(false)} onDone={bump} />}
    </>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(api.isAuthed());
  useEffect(() => {
    const out = () => setAuthed(false);
    window.addEventListener("orbit:logout", out);
    return () => window.removeEventListener("orbit:logout", out);
  }, []);
  if (!authed) return <Auth onAuthed={() => setAuthed(true)} />;
  return <PrefsProvider><Shell onSignOut={() => { api.logout(); setAuthed(false); }} /></PrefsProvider>;
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("orbit");
  const [rev, setRev] = useState(0);
  const [data, setData] = useState(false);
  const bump = () => setRev((r) => r + 1);

  const { loaded, onboarded, on } = usePrefs();
  const [mine, setMine] = useState(false);
  const TABS = ALL_TABS.filter(([k]) => (k !== "finance" || on("finance")) && (k !== "study" || on("study")));
  useEffect(() => { if ((tab === "finance" && !on("finance")) || (tab === "study" && !on("study"))) setTab("orbit"); }, [tab, on]);
  useEffect(() => { where.sub = ""; }, [tab]);

  if (!loaded) return <p className="p-10 text-muted">Loading…</p>;
  if (!onboarded) return <MakeOrbitYours first onClose={() => {}} />;

  return (
    <PlanetsProvider>
    <FocusProvider rev={rev}>
    <div className="mx-auto min-h-screen max-w-5xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sun/25"><span className="h-3.5 w-3.5 rounded-full bg-sun" /></span>
          <span className="text-lg font-semibold tracking-tight">Orbit</span>
        </div>
        <AccountMenu items={[{ label: "Make Orbit yours", onClick: () => setMine(true) }, { label: "Your data", onClick: () => setData(true) }, { label: "Sign out", onClick: onSignOut }]} />
      </header>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}>{label}</button>
        ))}
      </nav>
      <TermReminder rev={rev} bump={bump} />
      <ValuationReminder rev={rev} bump={bump} />
      <main>
        {tab === "dashboard" && <Dashboard rev={rev} bump={bump} />}
        {tab === "orbit" && <Space rev={rev} onNavigate={(t) => setTab(t)} bump={bump} />}
        {tab === "calendar" && <Calendar rev={rev} bump={bump} />}
        {tab === "study" && <Study rev={rev} bump={bump} />}
        {tab === "commitments" && <Commitments rev={rev} bump={bump} />}
        {tab === "finance" && <Finance rev={rev} bump={bump} />}
      </main>
      {data && <DataModal onClose={() => setData(false)} />}
      {mine && <MakeOrbitYours first={false} onClose={() => setMine(false)} />}
      <NotesButton tab={TABS.find(([k]) => k === tab)?.[1] ?? tab} onChanged={bump} />
    </div>
    </FocusProvider>
    </PlanetsProvider>
  );
}
