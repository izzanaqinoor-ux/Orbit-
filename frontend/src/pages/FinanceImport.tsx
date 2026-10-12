import { useMemo, useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import { Button, Card, ErrorNote, Field, inputCls } from "../components/ui";
import { money } from "../lib";
import type { FinCat, ImportCommitRow, ImportLine, ImportLineIn, ImportPreview, ImportResult, Pocket } from "../types";

/* ───────── CSV reading (all in the browser; the file itself is never uploaded) ───────── */
function parseCSV(text: string): string[][] {
  const first = text.split(/\r?\n/, 5).join("\n");
  const count = (c: string) => first.split(c).length - 1;
  const delim = [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0];
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell.trim()); cell = ""; if (row.some((c) => c !== "")) out.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell.trim()); if (row.some((c) => c !== "")) out.push(row);
  return out;
}

type Dfmt = "dmy" | "mdy" | "iso";
interface Map { date: number; desc: number; amount: number; debit: number; credit: number; balance: number }
interface FileState { id: number; name: string; table: string[][]; header: number; pocketId: string; map: Map; dfmt: Dfmt; flip: boolean }

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function parseDate(v: string, f: Dfmt): string | null {
  const s = v.trim().replace(/\s+\d{1,2}:\d{2}.*$/, "");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3})[a-z]*[-/. ,]*(\d{2,4})$/))) { y = +m[3]; mo = MONTHS.indexOf(m[2].toLowerCase()) + 1; d = +m[1]; if (mo < 1) return null; }
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) { y = +m[3]; if (f === "mdy") { mo = +m[1]; d = +m[2]; } else { d = +m[1]; mo = +m[2]; } }
  else return null;
  if (y < 100) y += 2000;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function parseAmount(v: string | undefined): number | null {
  if (v == null) return null;
  let s = v.trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /-/.test(s) || /\bDR\b/i.test(s);
  s = s.replace(/[^0-9.,]/g, "");
  if (/,\d{2}$/.test(s) && !/\.\d/.test(s)) s = s.replace(/\./g, "").replace(",", ".");   // 1.234,56
  else s = s.replace(/,/g, "");
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return Math.round(n * 100) * (neg ? -1 : 1);
}

const find = (h: string[], ...re: RegExp[]) => { for (const r of re) { const i = h.findIndex((c) => r.test(c)); if (i >= 0) return i; } return -1; };
function guess(table: string[][]): { header: number; map: Map; dfmt: Dfmt } {
  let header = table.findIndex((r) => r.length >= 3 && r.some((c) => /date/i.test(c)));
  if (header < 0) header = 0;
  const h = (table[header] ?? []).map((c) => c.toLowerCase());
  const map: Map = {
    date: find(h, /^(transaction |trans\.? |posting |value )?date/, /date/),
    desc: find(h, /descr|details|narrat|particular|remark|payee|memo|reference/),
    amount: find(h, /^amount|^value$|amt/),
    debit: find(h, /withdraw|debit|money out|paid out/),
    credit: find(h, /deposit|credit|money in|paid in/),
    balance: find(h, /balance/),
  };
  if (map.amount >= 0 && map.debit >= 0 && map.credit >= 0) map.amount = -1;
  let dfmt: Dfmt = "dmy";
  const dates = table.slice(header + 1, header + 60).map((r) => r[map.date] ?? "");
  if (dates.some((d) => /^\d{4}[-/.]/.test(d))) dfmt = "iso";
  else if (dates.some((d) => { const m = d.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]/); return m && +m[2] > 12; })) dfmt = "mdy";
  return { header, map, dfmt };
}

function rowsOf(f: FileState): { rows: ImportLineIn[]; skipped: number } {
  const rows: ImportLineIn[] = []; let skipped = 0;
  for (const r of f.table.slice(f.header + 1)) {
    const date = f.map.date >= 0 ? parseDate(r[f.map.date] ?? "", f.dfmt) : null;
    let amt: number | null = null;
    if (f.map.amount >= 0) amt = parseAmount(r[f.map.amount]);
    else {
      const dr = f.map.debit >= 0 ? parseAmount(r[f.map.debit]) : null, cr = f.map.credit >= 0 ? parseAmount(r[f.map.credit]) : null;
      if (dr) amt = -Math.abs(dr); else if (cr) amt = Math.abs(cr);
    }
    if (!date || !amt) { skipped++; continue; }
    const bal = f.map.balance >= 0 ? parseAmount(r[f.map.balance]) : null;
    rows.push({ pocket_id: f.pocketId, date, amount_cents: f.flip ? -amt : amt, description: (f.map.desc >= 0 ? r[f.map.desc] : "")?.slice(0, 300) ?? "", balance_cents: bal });
  }
  return { rows, skipped };
}

/* ───────── review state ───────── */
type Act = "expense" | "income" | "transfer" | "skip" | "link";
interface Choice { act: Act; cat: string; other: string; paired: boolean }

export function ImportStatements({ rev, bump }: { rev: number; bump: () => void }) {
  const pockets = useAsync(() => api.pockets(), [rev]);
  const cats = useAsync(() => api.categories(), [rev]);
  const done = useAsync(() => api.importSummary(), [rev]);
  const live = (pockets.data ?? []).filter((p) => !p.archived);
  const [files, setFiles] = useState<FileState[]>([]);
  const [pv, setPv] = useState<ImportPreview | null>(null);
  const [choice, setChoice] = useState<Record<number, Choice>>({});
  const [res, setRes] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => files.map(rowsOf), [files]);
  const all = useMemo(() => parsed.flatMap((p) => p.rows), [parsed]);
  const pname = (id: string) => live.find((p) => p.id === id)?.name ?? "Account";

  async function addFiles(list: FileList | null) {
    if (!list) return; setErr(null);
    const next: FileState[] = [];
    for (const file of Array.from(list)) {
      const table = parseCSV(await file.text());
      if (table.length < 2) { setErr(`“${file.name}” looks empty. Is it a CSV export?`); continue; }
      next.push({ id: Date.now() + next.length, name: file.name, table, pocketId: live[Math.min(files.length + next.length, live.length - 1)]?.id ?? "", flip: false, ...guess(table) });
    }
    setFiles((f) => [...f, ...next]);
  }
  const upd = (id: number, patch: Partial<FileState>) => setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const updMap = (id: number, k: keyof Map, v: number) => setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, map: { ...f.map, [k]: v } } : f)));

  async function review() {
    setErr(null); setBusy(true);
    try {
      const p = await api.importPreview(all);
      const c: Record<number, Choice> = {};
      for (const l of p.rows) {
        c[l.i] = { act: l.status === "imported" ? "skip" : l.status === "logged" ? "link" : l.status === "paired" ? "transfer" : l.amount_cents < 0 ? "expense" : "income", cat: l.category_id ?? "", other: "", paired: l.status === "paired" };
      }
      setPv(p); setChoice(c);
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  const lines = pv?.rows ?? [];
  const catsFor = (kind: "income" | "expense") => (cats.data ?? []).filter((c: FinCat) => c.kind === kind && !c.archived);
  const setC = (i: number, patch: Partial<Choice>) => setChoice((c) => ({ ...c, [i]: { ...c[i], ...patch } }));
  const setCat = (l: ImportLine, cat: string) => setChoice((c) => {
    const n = { ...c, [l.i]: { ...c[l.i], cat } };
    const key = l.description.toLowerCase().replace(/[\d*#]+/g, "").trim();
    for (const o of lines) if (o.i !== l.i && o.status === "new" && !n[o.i].cat && n[o.i].act === (l.amount_cents < 0 ? "expense" : "income") && o.amount_cents < 0 === l.amount_cents < 0 && o.description.toLowerCase().replace(/[\d*#]+/g, "").trim() === key) n[o.i] = { ...n[o.i], cat };
    return n;
  });

  const active = (l: ImportLine) => l.status !== "imported";
  const needs = lines.filter((l) => active(l) && ((choice[l.i]?.act === "expense" || choice[l.i]?.act === "income") && !choice[l.i].cat)).length;
  const needsOther = lines.filter((l) => active(l) && !choice[l.i]?.paired && choice[l.i]?.act === "transfer" && !choice[l.i].other).length;

  async function commit() {
    if (!pv) return; setErr(null); setBusy(true);
    try {
      const out: ImportCommitRow[] = pv.rows.map((l) => {
        const ch = choice[l.i], base = { pocket_id: l.pocket_id, date: l.date, amount_cents: l.amount_cents, description: l.description, balance_cents: all[l.i]?.balance_cents ?? null };
        if (l.status === "imported") return { ...base, action: "skip" };
        if (ch.paired && l.pair_with != null) return { ...base, action: "transfer", pair_key: `p${Math.min(l.i, l.pair_with)}` };
        if (ch.act === "link") return { ...base, action: "link", link_entry_id: l.entry_id };
        if (ch.act === "transfer") return { ...base, action: "transfer", other_pocket_id: ch.other };
        if (ch.act === "skip") return { ...base, action: "skip" };
        return { ...base, action: ch.act, category_id: ch.cat };
      });
      setRes(await api.importCommit(out)); setPv(null); setFiles([]); bump();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  /* ───── result ───── */
  if (res) {
    const c = res.counts;
    return (
      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Imported</h2>
        <p className="text-sm text-muted">{c.booked} new entr{c.booked === 1 ? "y" : "ies"}{c.transfers ? `, ${c.transfers} move${c.transfers === 1 ? "" : "s"} between your accounts` : ""}{c.linked ? `, ${c.linked} matched to things you'd already logged` : ""}{c.skipped ? `, ${c.skipped} skipped` : ""}{c.already_imported ? `, ${c.already_imported} were already in` : ""}.</p>
        {res.balance_checks.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.18em] text-faint">Does it agree with the bank?</p>
            {res.balance_checks.map((b) => (
              <div key={b.pocket_id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-surface2 px-3 py-2 text-sm">
                <span>{b.name} <span className="text-xs text-faint">as of {new Date(b.as_of + "T00:00").toLocaleDateString([], { day: "numeric", month: "short" })}</span></span>
                <span className="num">{b.diff_cents === 0 ? <span className="text-pos">matches the bank</span> : <span className="text-warn">Orbit {money(b.orbit_cents)} · bank {money(b.bank_cents)} · off by {money(Math.abs(b.diff_cents))}</span>}</span>
              </div>))}
            <p className="text-xs text-faint">A gap usually means an opening balance, a line not in the file, or an entry you logged that isn't in the bank yet.</p>
          </div>)}
        <Button onClick={() => setRes(null)}>Import more</Button>
      </Card>);
  }

  /* ───── review ───── */
  if (pv) {
    const counts = pv.counts;
    return (
      <div className="space-y-4">
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">Review {lines.length} lines</h2>
            <span className="text-xs text-faint">{counts.new ?? 0} new · {counts.paired ?? 0} between your accounts · {counts.logged ?? 0} already logged · {counts.imported ?? 0} seen before</span></div>
          <p className="mt-1 text-sm text-muted">Lines you already typed in are matched, not doubled. Money moving between two of your accounts becomes one move, so your total doesn't change.</p>
        </Card>
        <Card className="!p-0">
          <ul className="divide-y divide-line">
            {lines.filter((l) => !(l.status === "paired" && l.pair_with != null && l.pair_with < l.i && choice[l.i]?.paired)).map((l) => {
              const ch = choice[l.i]; if (!ch) return null;
              const out = l.amount_cents < 0, amt = <span className={`num shrink-0 ${out ? "" : "text-pos"}`}>{out ? "−" : "+"}{money(Math.abs(l.amount_cents))}</span>;
              const head = <div className="min-w-0 flex-1"><div className="truncate text-sm">{l.description || "(no description)"}</div><div className="text-xs text-faint">{new Date(l.date + "T00:00").toLocaleDateString([], { day: "numeric", month: "short" })} · {pname(l.pocket_id)}</div></div>;
              if (l.status === "imported") return <li key={l.i} className="flex items-center gap-3 px-4 py-2.5 opacity-50">{head}{amt}<span className="w-40 text-right text-xs text-faint">Already imported</span></li>;
              if (l.status === "paired" && l.pair_with != null) {
                const o = lines[l.pair_with], a = out ? l : o, b = out ? o : l;
                return (
                  <li key={l.i} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1"><div className="text-sm">{pname(a.pocket_id)} → {pname(b.pocket_id)}</div><div className="text-xs text-faint">{new Date(a.date + "T00:00").toLocaleDateString([], { day: "numeric", month: "short" })} · “{a.description || "out"}” and “{b.description || "in"}”</div></div>
                    <span className="num shrink-0">{money(Math.abs(a.amount_cents))}</span>
                    <select className={inputCls + " !w-44"} value={ch.paired ? "pair" : "no"} onChange={(e) => { const p = e.target.value === "pair"; for (const k of [l.i, l.pair_with!]) setC(k, { paired: p, act: p ? "transfer" : choice[k].act === "transfer" ? (lines[k].amount_cents < 0 ? "expense" : "income") : choice[k].act }); }}>
                      <option value="pair">One move between accounts</option><option value="no">Not a move, treat separately</option></select>
                  </li>);
              }
              if (l.status === "logged") return (
                <li key={l.i} className="flex flex-wrap items-center gap-3 px-4 py-2.5">{head}{amt}
                  <select className={inputCls + " !w-52"} value={ch.act === "link" ? "link" : "new"} onChange={(e) => setC(l.i, { act: e.target.value === "link" ? "link" : out ? "expense" : "income" })}>
                    <option value="link">Matches something I logged</option><option value="new">Actually a new one</option></select>
                  {ch.act !== "link" && <CatPick kind={out ? "expense" : "income"} cats={catsFor(out ? "expense" : "income")} value={ch.cat} onChange={(v) => setCat(l, v)} />}
                </li>);
              return (
                <li key={l.i} className="flex flex-wrap items-center gap-3 px-4 py-2.5">{head}{amt}
                  <select className={inputCls + " !w-36"} value={ch.act} onChange={(e) => setC(l.i, { act: e.target.value as Act })}>
                    <option value={out ? "expense" : "income"}>{out ? "Expense" : "Income"}</option><option value="transfer">Move (my account)</option><option value="skip">Skip</option></select>
                  {(ch.act === "expense" || ch.act === "income") && <CatPick kind={ch.act} cats={catsFor(ch.act)} value={ch.cat} onChange={(v) => setCat(l, v)} />}
                  {ch.act === "transfer" && <select className={inputCls + " !w-44"} value={ch.other} onChange={(e) => setC(l.i, { other: e.target.value })}><option value="">{out ? "Went to…" : "Came from…"}</option>{live.filter((p) => p.id !== l.pocket_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
                  {l.hint && ch.act !== "transfer" && <span className="basis-full text-xs text-faint">{l.hint}</span>}
                </li>);
            })}
          </ul>
        </Card>
        <ErrorNote msg={err} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => { setPv(null); setErr(null); }}>← Back</Button>
          <div className="flex items-center gap-3">
            {(needs > 0 || needsOther > 0) && <span className="text-sm text-warn">{needs > 0 ? `${needs} still need a category` : ""}{needs > 0 && needsOther > 0 ? " · " : ""}{needsOther > 0 ? `${needsOther} moves need an account` : ""}</span>}
            <Button disabled={busy || needs > 0 || needsOther > 0} onClick={commit}>{busy ? "Importing…" : "Import"}</Button>
          </div>
        </div>
      </div>);
  }

  /* ───── choose files ───── */
  const hasRows = all.length > 0;
  return (
    <div className="space-y-5">
      <ErrorNote msg={err} />
      <Card>
        <h2 className="mb-1 text-lg font-semibold">Import a bank statement</h2>
        <p className="mb-4 text-sm text-muted">Use each bank's CSV export, one file per account. You can upload as many as you like, any month, in any order. Lines already imported are recognised and ignored. The file is read in your browser; only the lines are sent.</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center rounded-lg bg-ink px-3.5 py-2 text-sm font-medium text-bg hover:bg-ink/85">Choose CSV files<input type="file" accept=".csv,text/csv,.txt" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} /></label>
          {import.meta.env.VITE_DEMO && <button className="text-sm text-muted underline hover:text-ink" onClick={() => setFiles(sampleFiles(live))}>Try with sample statements</button>}
        </div>
        {(done.data ?? []).some((d) => d.lines > 0) && (
          <p className="mt-4 text-xs text-faint">Imported so far: {(done.data ?? []).filter((d) => d.lines > 0).map((d) => `${d.name} (${d.lines} lines, ${fmtD(d.first)} – ${fmtD(d.last)})`).join(" · ")}</p>)}
      </Card>

      {files.map((f, k) => {
        const colSel = (label: string, key: keyof Map, optional = true) => (
          <Field label={label}><select className={inputCls} value={f.map[key]} onChange={(e) => updMap(f.id, key, Number(e.target.value))}>
            {optional && <option value={-1}>—</option>}{(f.table[f.header] ?? []).map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}</select></Field>);
        const p = parsed[k];
        return (
          <Card key={f.id} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{f.name}</span><button className="text-xs text-faint hover:text-neg" onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}>Remove</button></div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Which account is this?"><select className={inputCls} value={f.pocketId} onChange={(e) => upd(f.id, { pocketId: e.target.value })}>{live.map((x: Pocket) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
              {colSel("Date column", "date", false)}
              {colSel("Description column", "desc")}
              {f.map.amount >= 0 || (f.map.debit < 0 && f.map.credit < 0) ? colSel("Amount column (− = out)", "amount") : <>{colSel("Money out column", "debit")}{colSel("Money in column", "credit")}</>}
              {colSel("Balance column (optional)", "balance")}
              <Field label="Date order"><select className={inputCls} value={f.dfmt} onChange={(e) => upd(f.id, { dfmt: e.target.value as Dfmt })}><option value="dmy">Day / month / year</option><option value="mdy">Month / day / year</option><option value="iso">Year-month-day</option></select></Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={f.flip} onChange={(e) => upd(f.id, { flip: e.target.checked })} /> Flip signs (this bank shows spending as positive)</label>
              <span className={p.rows.length ? "text-muted" : "text-warn"}>{p.rows.length} lines read{p.skipped ? ` · ${p.skipped} skipped (no date or amount)` : ""}{p.rows.length ? ` · ${fmtD(p.rows.reduce((a, r) => (r.date < a ? r.date : a), "9999"))} – ${fmtD(p.rows.reduce((a, r) => (r.date > a ? r.date : a), ""))}` : ""}</span>
            </div>
            {p.rows.slice(0, 3).map((r, i) => <div key={i} className="flex justify-between gap-3 text-xs text-faint"><span className="truncate">{r.date} · {r.description}</span><span className="num">{money(r.amount_cents)}</span></div>)}
          </Card>);
      })}
      {hasRows && <div className="flex justify-end"><Button disabled={busy || files.some((f) => !f.pocketId)} onClick={review}>{busy ? "Checking…" : `Review ${all.length} lines →`}</Button></div>}
    </div>
  );
}

const fmtD = (d: string | null) => (d ? new Date(d + "T00:00").toLocaleDateString([], { day: "numeric", month: "short" }) : "");

function CatPick({ kind, cats, value, onChange }: { kind: "income" | "expense"; cats: FinCat[]; value: string; onChange: (v: string) => void }) {
  return <select className={inputCls + " !w-40"} value={value} onChange={(e) => onChange(e.target.value)}><option value="">{kind === "expense" ? "Pick a category" : "Pick income type"}</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>;
}

/** Demo only: two accounts with overlapping months and a transfer between them. */
function sampleFiles(pockets: Pocket[]): FileState[] {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const d = (day: number) => `${String(day).padStart(2, "0")}/${String(m + 1).padStart(2, "0")}/${y}`;
  const a = ["Date,Description,Amount", `${d(1)},SALARY CAFE LTD,1450.00`, `${d(3)},NTUC FAIRPRICE,-23.40`, `${d(4)},GRAB RIDE,-12.80`, `${d(6)},PAYNOW TRANSFER TO SAVINGS,-200.00`, `${d(8)},KOPI & TOAST,-4.60`].join("\n");
  const b = ["Date,Description,Amount", `${d(6)},INCOMING PAYNOW,200.00`, `${d(8)},INTEREST,0.35`].join("\n");
  const mk = (name: string, csv: string, idx: number): FileState => { const table = parseCSV(csv); return { id: Date.now() + idx, name, table, pocketId: pockets[idx]?.id ?? "", flip: false, ...guess(table) }; };
  return [mk("main-account.csv", a, 0), mk("savings-account.csv", b, Math.min(3, pockets.length - 1))];
}
