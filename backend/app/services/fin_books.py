"""Bookkeeping views: the monthly Dr/Cr statement + reconciliation, the weekly money summary, and investment check-ins."""
from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.fin import Entry, FinCategory, Holding, MonthClose, Pocket, Valuation
from app.services import fin as F

U, UNPROC = F.U, F.UNPROC


def _money(c: int, cur: str) -> str:
    from app.services import fin_engine as eng
    return eng.money(c, cur)


# ───────── monthly statement (double entry) ─────────

def _journal(entries, pname, cname, tname) -> list[dict]:
    out = []
    for e in entries:
        a = e.amount_cents
        if e.kind == "income":
            lines = [(pname(e.to_pocket_id), a, 0), (f"Income · {cname(e.category_id)}", 0, a)]
        elif e.kind == "expense":
            lines = [(f"Expense · {cname(e.category_id)}", a, 0), (pname(e.from_pocket_id), 0, a)]
        elif e.kind == "transfer":
            lines = [(pname(e.to_pocket_id), a, 0), (pname(e.from_pocket_id), 0, a)]
        elif e.kind == "contribution":
            lines = [(f"Investments · {tname(e.holding_id)}", a, 0), (pname(e.from_pocket_id) if e.from_pocket_id else "Cash outside Orbit", 0, a)]
        else:  # dividend
            lines = [((pname(e.to_pocket_id) if e.to_pocket_id else f"Investments · {tname(e.holding_id)}"), a, 0), (f"Dividend income · {tname(e.holding_id)}", 0, a)]
        out.append({"entry_id": e.id, "date": e.occurred_on, "kind": e.kind, "memo": e.note,
                    "lines": [{"account": n, "dr_cents": d, "cr_cents": c} for n, d, c in lines]})
    return out


def _suggest_destination(db: Session, uid: str) -> dict | None:
    d = F.dashboard(db, uid, None)
    pockets = {p["id"]: p for p in d["pockets"]}
    cfg = F.current_rules(db, uid).config
    if d["invest_priority"] == "cash":
        want = cfg["conditions"].get("redirect_to", "emergency")
        p = next((p for p in d["pockets"] if p["purpose"] == want and p["role"] == "savings"), None)
        if p:
            return {"pocket_id": p["id"], "name": p["name"], "reason": "Your liquid cash is under your buffer, so cash comes first."}
    for g in d["goals"]:
        if g["kind"] == "pocket" and g.get("pocket_id") in pockets and g["status"] in ("behind", "overdue"):
            p = pockets[g["pocket_id"]]
            return {"pocket_id": p["id"], "name": p["name"], "reason": f"Your “{g['title']}” goal is behind its pace."}
    p = next((p for p in d["pockets"] if p["purpose"] == "general" and p["role"] == "savings"), None)
    return {"pocket_id": p["id"], "name": p["name"], "reason": "Nothing is urgent, so it goes to general savings."} if p else None


def statement(db: Session, uid: str, month: str | None) -> dict:
    u = F._user(db, uid)
    today = F._today(u)
    start, nxt = F.month_bounds(month, today)
    pockets = list(db.execute(select(Pocket).where(Pocket.user_id == uid).order_by(Pocket.created_at)).scalars())
    pn = {p.id: p.name for p in pockets}
    cn = {c.id: c.name for c in db.execute(select(FinCategory).where(FinCategory.user_id == uid)).scalars()}
    tn = {h.id: h.ticker for h in db.execute(select(Holding).where(Holding.user_id == uid)).scalars()}
    entries = list(db.execute(select(Entry).where(Entry.user_id == uid, Entry.occurred_on >= start, Entry.occurred_on < nxt)
                              .order_by(Entry.occurred_on, Entry.created_at)).scalars())
    journal = _journal(entries, lambda i: pn.get(i, "—"), lambda i: cn.get(i, "Uncategorised"), lambda i: tn.get(i, "?"))
    dr = sum(l["dr_cents"] for j in journal for l in j["lines"])
    cr = sum(l["cr_cents"] for j in journal for l in j["lines"])
    opening, closing = F.pocket_balances(db, uid, upto=start), F.pocket_balances(db, uid, upto=nxt)
    ins, outs = defaultdict(int), defaultdict(int)
    for e in entries:
        if e.to_pocket_id:
            ins[e.to_pocket_id] += e.amount_cents
        if e.from_pocket_id:
            outs[e.from_pocket_id] += e.amount_cents
    closes = {c.pocket_id: c for c in db.execute(select(MonthClose).where(MonthClose.user_id == uid, MonthClose.month == start)).scalars()}
    rows = []
    for p in pockets:
        if p.archived and not (opening.get(p.id) or ins[p.id] or outs[p.id]):
            continue
        c = closes.get(p.id)
        rows.append({"pocket_id": p.id, "name": p.name, "role": p.role, "opening_cents": opening.get(p.id, 0), "in_cents": ins[p.id],
                     "out_cents": outs[p.id], "closing_cents": closing.get(p.id, 0),
                     "close": None if c is None else {"expected_cents": c.expected_cents, "actual_cents": c.actual_cents, "diff_cents": c.diff_cents,
                                                      "destination_pocket_id": c.destination_pocket_id, "cap_cut_cents": c.cap_cut_cents}})
    cfg = F.current_rules(db, uid).config
    eff, cut = F.cap_for_month(db, uid, nxt, cfg["spending_cap_cents"])
    pending_cut = int(db.execute(select(func.coalesce(func.sum(MonthClose.cap_cut_cents), 0)).where(MonthClose.user_id == uid, MonthClose.month == start)).scalar_one())
    return {"month": start.strftime("%Y-%m"), "currency": u.currency, "journal": journal,
            "totals": {"dr_cents": dr, "cr_cents": cr, "tallies": dr == cr}, "pockets": rows,
            "suggestion": _suggest_destination(db, uid),
            "next_month_cap": {"base_cents": cfg["spending_cap_cents"], "cut_cents": pending_cut, "effective_cents": max(0, cfg["spending_cap_cents"] - pending_cut)},
            "is_future": start > today}


def _cat(db: Session, uid: str, name: str, kind: str) -> FinCategory:
    c = db.execute(select(FinCategory).where(FinCategory.user_id == uid, FinCategory.name == name)).scalar_one_or_none()
    if c is None:
        c = FinCategory(user_id=uid, name=name, kind=kind, counts_toward_cap=False)
        db.add(c)
        db.flush()
    elif c.archived:
        c.archived = False
    return c


def settle(db: Session, uid: str, month: str, items: list) -> dict:
    """Make the books match what you really have. Extra cash → income (+ move to a savings pocket). Missing cash → unrecorded
    spending, and next month's cap shrinks by the same amount so it isn't punished twice."""
    u = F._user(db, uid)
    today = F._today(u)
    start, nxt = F.month_bounds(month, today)
    if start > today:
        raise U(UNPROC, "That month hasn't started yet.")
    when = min(today, nxt - timedelta(days=1))
    bal = F.pocket_balances(db, uid, upto=nxt)
    made = 0
    try:
        for it in items:
            p = F._own(db, Pocket, uid, it.pocket_id, "pocket")
            if db.execute(select(MonthClose.id).where(MonthClose.user_id == uid, MonthClose.month == start, MonthClose.pocket_id == p.id)).first():
                raise U(status_conflict(), f"{p.name} is already reconciled for this month. Undo it first to redo.")
            dest = F._own(db, Pocket, uid, it.destination_pocket_id, "pocket") if it.destination_pocket_id else None
            if dest is not None and dest.id == p.id:
                dest = None
            expected = bal.get(p.id, 0)
            diff = it.actual_cents - expected
            ids: list[str] = []
            cut = 0
            if diff > 0:
                cat = _cat(db, uid, "Unrecorded cash", "income")
                e = Entry(user_id=uid, kind="income", amount_cents=diff, occurred_on=when, note="Reconciliation: cash not entered", category_id=cat.id, to_pocket_id=p.id)
                db.add(e); db.flush(); ids.append(e.id)
                if dest is not None:
                    t = Entry(user_id=uid, kind="transfer", amount_cents=diff, occurred_on=when, note="Reconciliation: surplus moved", from_pocket_id=p.id, to_pocket_id=dest.id)
                    db.add(t); db.flush(); ids.append(t.id)
            elif diff < 0:
                cat = _cat(db, uid, "Unrecorded spending", "expense")
                e = Entry(user_id=uid, kind="expense", amount_cents=-diff, occurred_on=when, note="Reconciliation: spending not entered", category_id=cat.id, from_pocket_id=p.id)
                db.add(e); db.flush(); ids.append(e.id)
                cut = -diff
            db.add(MonthClose(user_id=uid, month=start, pocket_id=p.id, expected_cents=expected, actual_cents=it.actual_cents, diff_cents=diff,
                              destination_pocket_id=dest.id if (diff > 0 and dest) else None, cap_cut_cents=cut, entry_ids=ids))
            made += 1
        db.commit()
    except IntegrityError as ex:
        db.rollback()
        raise U(UNPROC, "Could not reconcile that.") from ex
    except Exception:
        db.rollback()
        raise
    return statement(db, uid, start.strftime("%Y-%m"))


def status_conflict() -> int:
    return 409


def undo_settle(db: Session, uid: str, month: str, pocket_id: str) -> dict:
    u = F._user(db, uid)
    start, _ = F.month_bounds(month, F._today(u))
    c = db.execute(select(MonthClose).where(MonthClose.user_id == uid, MonthClose.month == start, MonthClose.pocket_id == pocket_id)).scalar_one_or_none()
    if c is None:
        raise U(404, "Nothing to undo.")
    for eid in c.entry_ids:
        e = db.execute(select(Entry).where(Entry.id == eid, Entry.user_id == uid)).scalar_one_or_none()
        if e is not None:
            db.delete(e)
    db.delete(c)
    db.commit()
    return statement(db, uid, start.strftime("%Y-%m"))


# ───────── weekly money summary ─────────

def week_summary(db: Session, uid: str, week_start: date | None) -> dict:
    u = F._user(db, uid)
    today = F._today(u)
    monday = week_start or (today - timedelta(days=today.weekday()))
    monday = monday - timedelta(days=monday.weekday())
    nxt = monday + timedelta(days=7)
    cats = {c.id: c for c in db.execute(select(FinCategory).where(FinCategory.user_id == uid)).scalars()}
    es = db.execute(select(Entry).where(Entry.user_id == uid, Entry.occurred_on >= monday, Entry.occurred_on < nxt)).scalars().all()
    income = sum(e.amount_cents for e in es if e.kind == "income")
    spent = sum(e.amount_cents for e in es if e.kind == "expense")
    spent_cap = sum(e.amount_cents for e in es if e.kind == "expense" and (cats.get(e.category_id) is None or cats[e.category_id].counts_toward_cap))
    invested = sum(e.amount_cents for e in es if e.kind == "contribution")
    by_cat: dict[str, int] = defaultdict(int)
    for e in es:
        if e.kind == "expense":
            by_cat[cats[e.category_id].name if e.category_id in cats else "Uncategorised"] += e.amount_cents
    w = F.work_income(db, u, monday, nxt)
    so_far_end = min(nxt, today + timedelta(days=1)) if monday <= today else monday
    sf = F.work_income(db, u, monday, so_far_end) if so_far_end > monday else {"scheduled_hours": 0, "expected_hourly_pay_cents": 0}
    rate = (w["expected_hourly_pay_cents"] / w["scheduled_hours"]) if w["scheduled_hours"] > 0 else 0
    cfg = F.current_rules(db, uid).config
    month_start = today.replace(day=1)
    eff, _ = F.cap_for_month(db, uid, month_start, cfg["spending_cap_cents"])
    dim = calendar.monthrange(month_start.year, month_start.month)[1]
    return {"week_start": monday, "week_end": nxt - timedelta(days=1), "currency": u.currency,
            "hours_scheduled": w["scheduled_hours"], "hours_so_far": sf["scheduled_hours"],
            "expected_pay_cents": w["expected_hourly_pay_cents"], "earned_so_far_cents": sf["expected_hourly_pay_cents"],
            "hourly_rate_cents": int(round(rate)), "income_logged_cents": income, "spent_cents": spent, "spent_toward_cap_cents": spent_cap,
            "invested_cents": invested, "left_cents": income - spent, "weekly_cap_cents": int(eff * 7 / dim),
            "spent_in_work_hours": round(spent / rate, 1) if rate > 0 else None,
            "top_categories": [{"name": k, "cents": v} for k, v in sorted(by_cat.items(), key=lambda kv: -kv[1])[:3]]}


# ───────── monthly investment check-in ─────────

def _cost_at(h: Holding, contribs: list[Entry], d: date) -> int:
    return h.opening_cost_cents + sum(e.amount_cents for e in contribs if e.holding_id == h.id and e.occurred_on <= d)


def valuations(db: Session, uid: str) -> dict:
    u = F._user(db, uid)
    today = F._today(u)
    hs = {h.id: h for h in db.execute(select(Holding).where(Holding.user_id == uid)).scalars()}
    contribs = list(db.execute(select(Entry).where(Entry.user_id == uid, Entry.kind == "contribution")).scalars())
    vals = list(db.execute(select(Valuation).where(Valuation.user_id == uid).order_by(Valuation.month)).scalars())
    by_month: dict[date, dict[str, Valuation]] = defaultdict(dict)
    for v in vals:
        by_month[v.month][v.holding_id] = v
    history, prev = [], None
    chain = 1.0
    for m in sorted(by_month):
        cur = by_month[m]
        value = sum(v.value_cents for v in cur.values())
        cost = sum(_cost_at(hs[hid], contribs, v.recorded_on) for hid, v in cur.items())
        mret = None
        if prev is not None:
            both = [hid for hid in cur if hid in prev]
            v0 = sum(prev[hid].value_cents for hid in both)
            v1 = sum(cur[hid].value_cents for hid in both)
            c = sum(e.amount_cents for e in contribs if e.holding_id in both and prev[e.holding_id].recorded_on < e.occurred_on <= cur[e.holding_id].recorded_on)
            if v0 + c / 2 > 0:
                mret = (v1 - v0 - c) / (v0 + c / 2)
                chain *= 1 + mret
        history.append({"month": m.strftime("%Y-%m"), "recorded_on": max(v.recorded_on for v in cur.values()), "value_cents": value, "cost_cents": cost,
                        "gain_cents": value - cost, "gain_pct": ((value - cost) / cost) if cost > 0 else None, "month_return": mret,
                        "by_holding": [{"ticker": hs[hid].ticker, "value_cents": v.value_cents} for hid, v in cur.items()]})
        prev = cur
    pos = [p for p in F.holding_positions(db, uid) if not p["archived"]]
    this_m = today.replace(day=1)
    have = by_month.get(this_m, {})
    tracked = [p for p in pos if p["cost_cents"] > 0 or p["value_cents"] > 0 or p["units"] > 0]
    due = bool(tracked) and today.day >= u.valuation_day and any(p["id"] not in have for p in tracked)
    last_val: dict[str, int] = {}
    for v in vals:
        last_val[v.holding_id] = v.value_cents
    return {"valuation_day": u.valuation_day, "due": due, "due_month": this_m.strftime("%Y-%m") if due else None,
            "holdings": [{"id": p["id"], "ticker": p["ticker"], "name": p["name"], "units": p["units"], "cost_cents": p["cost_cents"],
                          "book_value_cents": p["value_cents"], "last_value_cents": last_val.get(p["id"]),
                          "recorded_this_month": p["id"] in have} for p in tracked],
            "history": history, "latest": history[-1] if history else None,
            "cumulative_return": (chain - 1) if any(h["month_return"] is not None for h in history) else None,
            "next_check_in": (this_m.replace(day=u.valuation_day) if today.day < u.valuation_day else
                              date(this_m.year + (this_m.month == 12), this_m.month % 12 + 1, u.valuation_day))}


def record_valuations(db: Session, uid: str, month: str | None, values: list) -> dict:
    u = F._user(db, uid)
    today = F._today(u)
    start, _ = F.month_bounds(month, today)
    pos = {p["id"]: p for p in F.holding_positions(db, uid)}
    for it in values:
        h = F._own(db, Holding, uid, it.holding_id, "holding")
        v = db.execute(select(Valuation).where(Valuation.user_id == uid, Valuation.holding_id == h.id, Valuation.month == start)).scalar_one_or_none()
        if v is None:
            db.add(Valuation(user_id=uid, holding_id=h.id, month=start, value_cents=it.value_cents, recorded_on=today))
        else:
            v.value_cents, v.recorded_on = it.value_cents, today
        p = pos.get(h.id)
        if p and p["units"] > 0 and not p["units_missing"]:      # keep the portfolio and net worth in step with what you told us
            h.price_cents = int(round(it.value_cents / p["units"]))
            h.price_as_of = today
    db.commit()
    return valuations(db, uid)
