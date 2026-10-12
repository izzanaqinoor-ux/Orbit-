"""
Bank-statement import. The browser parses the CSV; this module decides what each line *is*:

  imported  we've seen this exact line before (re-uploading an overlapping statement is safe)
  logged    it matches an entry you already typed in by hand (same account, amount, within 2 days)
  paired    it mirrors a line in another account's statement (same amount, opposite sign, within 3 days):
            that's ONE transfer between your own accounts, not an expense plus an income
  new       everything else

Multiple files per month are fine: each line is judged by its own date and account.
"""
from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.fin import Entry, FinCategory, ImportRow, ImportRule, Pocket
from app.services import fin as F

U, UNPROC = F.U, F.UNPROC
PAIR_DAYS, MATCH_DAYS = 3, 2
TRANSFERISH = re.compile(r"transfer|top.?up|paynow|fast\b|giro|own account|gxs|savings pocket|to savings|from savings", re.I)


def merchant_key(desc: str) -> str:
    s = re.sub(r"[^a-z\s]", " ", (desc or "").lower())
    return " ".join([w for w in s.split() if len(w) > 1][:3])


def _fp_keys(rows) -> list[str]:
    seen: dict[str, int] = defaultdict(int)
    out = []
    for r in rows:
        norm = re.sub(r"\s+", " ", (r.description or "").strip().lower())
        base = hashlib.sha1(f"{r.pocket_id}|{r.date.isoformat()}|{r.amount_cents}|{norm}".encode()).hexdigest()[:20]
        out.append(f"{base}:{seen[base]}")
        seen[base] += 1
    return out


def _check_pockets(db: Session, uid: str, rows) -> dict[str, Pocket]:
    ids = {r.pocket_id for r in rows}
    ps = {p.id: p for p in db.execute(select(Pocket).where(Pocket.user_id == uid, Pocket.id.in_(ids))).scalars()}
    if len(ps) != len(ids):
        raise U(UNPROC, "One of those accounts isn't yours.")
    return ps


def preview(db: Session, uid: str, rows: list) -> dict:
    F._user(db, uid)
    if not rows:
        return {"rows": [], "counts": {}}
    _check_pockets(db, uid, rows)
    keys = _fp_keys(rows)
    known = {r.fp_key: r for r in db.execute(select(ImportRow).where(ImportRow.user_id == uid, ImportRow.fp_key.in_(keys))).scalars()}
    lo, hi = min(r.date for r in rows) - timedelta(days=MATCH_DAYS), max(r.date for r in rows) + timedelta(days=MATCH_DAYS)
    entries = list(db.execute(select(Entry).where(Entry.user_id == uid, Entry.occurred_on >= lo, Entry.occurred_on <= hi)).scalars())
    used = {(r.entry_id, r.pocket_id) for r in db.execute(select(ImportRow).where(ImportRow.user_id == uid, ImportRow.entry_id.is_not(None))).scalars()}
    rules = {r.merchant_key: r.category_id for r in db.execute(select(ImportRule).where(ImportRule.user_id == uid)).scalars()}

    out: list[dict] = []
    for i, (r, k) in enumerate(zip(rows, keys)):
        out.append({"i": i, "fp_key": k, "pocket_id": r.pocket_id, "date": r.date, "amount_cents": r.amount_cents, "description": r.description,
                    "status": "imported" if k in known else "new", "imported_as": known[k].status if k in known else None,
                    "entry_id": None, "pair_with": None, "category_id": None, "hint": None})

    # 1) lines that match something you already typed in
    for o in sorted((o for o in out if o["status"] == "new"), key=lambda o: o["date"]):
        out_flow = o["amount_cents"] < 0
        best, gap = None, 99
        for e in entries:
            if e.amount_cents != abs(o["amount_cents"]) or (e.id, o["pocket_id"]) in used:
                continue
            if (e.from_pocket_id if out_flow else e.to_pocket_id) != o["pocket_id"]:
                continue
            g = abs((e.occurred_on - o["date"]).days)
            if g <= MATCH_DAYS and g < gap:
                best, gap = e, g
        if best is not None:
            used.add((best.id, o["pocket_id"]))
            o["status"], o["entry_id"] = "logged", best.id

    # 2) one line out of an account + one line into another = a single transfer
    free = [o for o in out if o["status"] == "new"]
    cands = []
    for a in (o for o in free if o["amount_cents"] < 0):
        for b in (o for o in free if o["amount_cents"] > 0):
            if a["pocket_id"] != b["pocket_id"] and -a["amount_cents"] == b["amount_cents"] and abs((a["date"] - b["date"]).days) <= PAIR_DAYS:
                cands.append((abs((a["date"] - b["date"]).days), 0 if (TRANSFERISH.search(a["description"] or "") or TRANSFERISH.search(b["description"] or "")) else 1, a["i"], b["i"]))
    taken: set[int] = set()
    for _, _, ai, bi in sorted(cands):
        if ai in taken or bi in taken:
            continue
        taken |= {ai, bi}
        out[ai].update(status="paired", pair_with=bi)
        out[bi].update(status="paired", pair_with=ai)

    for o in out:
        if o["status"] == "new":
            o["category_id"] = rules.get(merchant_key(o["description"]))
            if TRANSFERISH.search(o["description"] or ""):
                o["hint"] = "Looks like a transfer. If it went to another of your accounts, mark it as a move."
    counts: dict[str, int] = defaultdict(int)
    for o in out:
        counts[o["status"]] += 1
    return {"rows": out, "counts": dict(counts)}


def commit(db: Session, uid: str, rows: list) -> dict:
    u = F._user(db, uid)
    if not rows:
        raise U(UNPROC, "Nothing to import.")
    pockets = _check_pockets(db, uid, rows)
    keys = _fp_keys(rows)
    known = {r.fp_key for r in db.execute(select(ImportRow).where(ImportRow.user_id == uid, ImportRow.fp_key.in_(keys))).scalars()}
    cats = {c.id: c for c in db.execute(select(FinCategory).where(FinCategory.user_id == uid)).scalars()}
    counts = {"booked": 0, "transfers": 0, "skipped": 0, "linked": 0, "already_imported": 0}
    new_rows: list[ImportRow] = []

    def add_row(r, k, status, entry_id=None):
        new_rows.append(ImportRow(user_id=uid, pocket_id=r.pocket_id, fp_key=k, occurred_on=r.date, amount_cents=r.amount_cents,
                                  description=(r.description or "")[:300], status=status, entry_id=entry_id))

    def mk_transfer(frm: str, to: str, amount: int, d: date, note: str) -> Entry:
        e = Entry(user_id=uid, kind="transfer", amount_cents=amount, occurred_on=d, note=note, from_pocket_id=frm, to_pocket_id=to)
        db.add(e)
        db.flush()
        return e

    try:
        pairs: dict[str, list[int]] = defaultdict(list)
        for i, r in enumerate(rows):
            if keys[i] in known:
                counts["already_imported"] += 1
            elif r.action == "transfer" and r.pair_key:
                pairs[r.pair_key].append(i)
        done: set[int] = set()
        for pk, idx in pairs.items():
            if len(idx) != 2:
                raise U(UNPROC, "A paired transfer needs exactly two lines, one out of one account and one into another.")
            a, b = sorted(idx, key=lambda j: rows[j].amount_cents)          # a is the outflow
            ra, rb = rows[a], rows[b]
            if not (ra.amount_cents < 0 < rb.amount_cents and -ra.amount_cents == rb.amount_cents and ra.pocket_id != rb.pocket_id):
                raise U(UNPROC, "Those two lines don't match up as a transfer (amounts must be equal, one out and one in, in different accounts).")
            e = mk_transfer(ra.pocket_id, rb.pocket_id, rb.amount_cents, ra.date, "Bank import: transfer between your accounts")
            add_row(ra, keys[a], "booked", e.id)
            add_row(rb, keys[b], "booked", e.id)
            counts["transfers"] += 1
            done |= {a, b}
        for i, r in enumerate(rows):
            if keys[i] in known or i in done:
                continue
            note = f"Bank import: {(r.description or '').strip()[:80]}".strip()
            if r.action == "skip":
                add_row(r, keys[i], "skipped"); counts["skipped"] += 1
            elif r.action == "link":
                e = db.execute(select(Entry).where(Entry.id == r.link_entry_id, Entry.user_id == uid)).scalar_one_or_none() if r.link_entry_id else None
                if e is None:
                    raise U(UNPROC, "That line points at an entry that doesn't exist.")
                add_row(r, keys[i], "linked", e.id); counts["linked"] += 1
            elif r.action in ("expense", "income"):
                want = "expense" if r.action == "expense" else "income"
                if (r.amount_cents < 0) != (want == "expense"):
                    raise U(UNPROC, f"“{r.description[:40]}” is money {'in' if r.amount_cents > 0 else 'out'}, so it can't be {'an expense' if want == 'expense' else 'income'}.")
                c = cats.get(r.category_id or "")
                if c is None or c.kind != want:
                    raise U(UNPROC, f"Pick a{'n expense' if want == 'expense' else ' income'} category for “{r.description[:40]}”.")
                e = Entry(user_id=uid, kind=want, amount_cents=abs(r.amount_cents), occurred_on=r.date, note=note, category_id=c.id,
                          from_pocket_id=r.pocket_id if want == "expense" else None, to_pocket_id=r.pocket_id if want == "income" else None)
                db.add(e); db.flush()
                add_row(r, keys[i], "booked", e.id); counts["booked"] += 1
                mk = merchant_key(r.description)
                if mk:
                    rule = db.execute(select(ImportRule).where(ImportRule.user_id == uid, ImportRule.merchant_key == mk)).scalar_one_or_none()
                    if rule is None:
                        db.add(ImportRule(user_id=uid, merchant_key=mk, category_id=c.id))
                    else:
                        rule.category_id = c.id
            elif r.action == "transfer":
                other = pockets.get(r.other_pocket_id or "") or db.execute(select(Pocket).where(Pocket.id == r.other_pocket_id, Pocket.user_id == uid)).scalar_one_or_none()
                if other is None or other.id == r.pocket_id:
                    raise U(UNPROC, f"Pick which of your other accounts “{r.description[:40]}” went to or came from.")
                frm, to = (r.pocket_id, other.id) if r.amount_cents < 0 else (other.id, r.pocket_id)
                e = mk_transfer(frm, to, abs(r.amount_cents), r.date, note)
                add_row(r, keys[i], "booked", e.id); counts["transfers"] += 1
            else:
                raise U(UNPROC, "Unknown action.")
        db.add_all(new_rows)
        db.commit()
    except IntegrityError as ex:
        db.rollback()
        raise U(UNPROC, "Some of those lines were already imported by another upload. Preview again.") from ex
    except Exception:
        db.rollback()
        raise

    checks = []
    last_by_pocket: dict[str, tuple[date, int]] = {}
    for r in rows:
        if r.balance_cents is not None and (r.pocket_id not in last_by_pocket or r.date >= last_by_pocket[r.pocket_id][0]):
            last_by_pocket[r.pocket_id] = (r.date, r.balance_cents)
    for pid, (d, bank) in last_by_pocket.items():
        orbit = F.pocket_balances(db, uid, upto=d + timedelta(days=1)).get(pid, 0)
        checks.append({"pocket_id": pid, "name": pockets[pid].name, "as_of": d, "bank_cents": bank, "orbit_cents": orbit, "diff_cents": bank - orbit})
    return {"counts": counts, "balance_checks": checks}


def summary(db: Session, uid: str) -> list[dict]:
    F._user(db, uid)
    out = []
    for p in db.execute(select(Pocket).where(Pocket.user_id == uid, Pocket.archived.is_(False)).order_by(Pocket.created_at)).scalars():
        rs = db.execute(select(ImportRow.occurred_on).where(ImportRow.user_id == uid, ImportRow.pocket_id == p.id)).scalars().all()
        out.append({"pocket_id": p.id, "name": p.name, "lines": len(rs), "first": min(rs) if rs else None, "last": max(rs) if rs else None})
    return out
