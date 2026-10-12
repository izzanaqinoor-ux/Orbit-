"""DB-aware finance service: seeding, balances, positions, dashboard, planning, scenarios."""
from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.commitment import Commitment
from app.models.extensions import Shift
from app.models.fin import (MonthClose, Valuation, BalanceItem, Entry, WishlistItem, FinCategory, FinGoal, Holding, IncomeSource, Milestone, Pocket, RuleSet,
                            Scenario, Snapshot)
from app.models.user import Job, User
from app.services import fin_engine as eng
from app.services.recurrence_service import virtual_occurrences
from app.services.schedule import list_terms

U = HTTPException
UNPROC = status.HTTP_422_UNPROCESSABLE_ENTITY

SEED_POCKETS = [
    ("Main account", "spending", "main", None, True, 0),
    ("Emergency cash", "savings", "emergency", "GXS", True, 0),
    ("Travel fund", "savings", "travel", "GXS", True, 0),
    ("General savings", "savings", "general", "GXS", True, 0),
    ("Car licence fund", "earmarked", "earmarked", None, False, 250000),
]
SEED_EXPENSE = [("Food", True), ("Transport", True), ("Daily spending", True), ("Going out", True), ("Shopping", True),
                ("Subscriptions", True), ("iCloud", True), ("Spotify", True), ("Other necessary", True),
                ("Car licence", False)]
SEED_INCOME = ["Part-time", "Allowance", "Internship", "Full-time", "Freelance / side", "Other income"]


# ───────── seeding ─────────

def seed_finance(db: Session, user: User) -> None:
    today = _today(user)
    for n, role, purpose, prov, liq, opening in SEED_POCKETS:
        db.add(Pocket(user_id=user.id, name=n, role=role, purpose=purpose, provider=prov, is_liquid=liq, opening_cents=opening))
    for n, cap in SEED_EXPENSE:
        db.add(FinCategory(user_id=user.id, name=n, kind="expense", counts_toward_cap=cap))
    for n in SEED_INCOME:
        db.add(FinCategory(user_id=user.id, name=n, kind="income", counts_toward_cap=False))
    for t in ("SPUS", "G3B", "AAPL"):
        db.add(Holding(user_id=user.id, ticker=t))
    db.add(RuleSet(user_id=user.id, name="Current rules", status="current", effective_from=today, config=eng.default_rules(),
                   note="Starting values come from what you told Orbit. Every number is editable; allocation percentages start unset."))
    for age, lo, hi, note in eng.ROADMAP:
        db.add(Milestone(user_id=user.id, age=age, nw_low_cents=lo * 100, nw_high_cents=hi * 100 if hi else None, note=note))
    db.add(IncomeSource(user_id=user.id, name="Allowance", kind="allowance", monthly_cents=20000, pays_in_term=True, pays_in_break=False))


def ensure_seeded(db: Session, user: User) -> None:
    if db.execute(select(RuleSet.id).where(RuleSet.user_id == user.id).limit(1)).first() is None:
        seed_finance(db, user)
        db.commit()


# ───────── helpers ─────────

def _user(db: Session, uid: str) -> User:
    u = db.execute(select(User).where(User.id == uid)).scalar_one()
    ensure_seeded(db, u)
    return u


def _today(u: User) -> date:
    return datetime.now(timezone.utc).astimezone(ZoneInfo(u.timezone)).date()


def month_bounds(m: str | None, today: date) -> tuple[date, date]:
    if m:
        try:
            y, mo = map(int, m.split("-"))
            start = date(y, mo, 1)
        except Exception as e:  # noqa: BLE001
            raise U(UNPROC, "month must look like 2026-10") from e
    else:
        start = today.replace(day=1)
    nxt = date(start.year + (start.month == 12), start.month % 12 + 1, 1)
    return start, nxt


def _prev(start: date) -> date:
    return date(start.year - (start.month == 1), (start.month - 2) % 12 + 1, 1)


def current_rules(db: Session, uid: str) -> RuleSet:
    r = db.execute(select(RuleSet).where(RuleSet.user_id == uid, RuleSet.status == "current")).scalar_one_or_none()
    if r is None:
        raise U(status.HTTP_404_NOT_FOUND, "No current rule set")
    return r


def cap_for_month(db: Session, uid: str, start: date, base: int) -> tuple[int, int]:
    """(effective cap, cut). A shortfall found when reconciling last month trims this month's cap."""
    cut = int(db.execute(select(func.coalesce(func.sum(MonthClose.cap_cut_cents), 0))
                         .where(MonthClose.user_id == uid, MonthClose.month == _prev(start))).scalar_one())
    return max(0, base - cut), cut


def _own(db: Session, model, uid: str, id_: str | None, what: str):
    if id_ is None:
        return None
    row = db.execute(select(model).where(model.id == id_, model.user_id == uid)).scalar_one_or_none()
    if row is None:
        raise U(UNPROC, f"Unknown {what}.")
    return row


# ───────── balances and positions ─────────

def pocket_balances(db: Session, uid: str, upto: date | None = None) -> dict[str, int]:
    pockets = db.execute(select(Pocket).where(Pocket.user_id == uid)).scalars().all()
    bal = {p.id: p.opening_cents for p in pockets}

    def sums(col):
        q = select(col, func.coalesce(func.sum(Entry.amount_cents), 0)).where(Entry.user_id == uid, col.is_not(None))
        if upto:
            q = q.where(Entry.occurred_on < upto)
        return db.execute(q.group_by(col)).all()

    for pid, s in sums(Entry.to_pocket_id):
        bal[pid] = bal.get(pid, 0) + int(s)
    for pid, s in sums(Entry.from_pocket_id):
        bal[pid] = bal.get(pid, 0) - int(s)
    return bal


def holding_positions(db: Session, uid: str) -> list[dict]:
    hs = db.execute(select(Holding).where(Holding.user_id == uid).order_by(Holding.ticker)).scalars().all()
    agg = {r[0]: r for r in db.execute(
        select(Entry.holding_id, func.coalesce(func.sum(Entry.units), 0), func.coalesce(func.sum(Entry.amount_cents), 0),
               func.count().filter(Entry.units.is_(None)))
        .where(Entry.user_id == uid, Entry.kind == "contribution").group_by(Entry.holding_id)).all()}
    divs = dict(db.execute(select(Entry.holding_id, func.coalesce(func.sum(Entry.amount_cents), 0))
                           .where(Entry.user_id == uid, Entry.kind == "dividend").group_by(Entry.holding_id)).all())
    out = []
    for h in hs:
        a = agg.get(h.id)
        units = Decimal(h.opening_units) + (Decimal(a[1]) if a else Decimal(0))
        cost = h.opening_cost_cents + (int(a[2]) if a else 0)
        missing = bool(a and a[3] > 0)
        priced = h.price_cents is not None and not missing and units > 0
        value = int((units * Decimal(h.price_cents)).to_integral_value()) if priced else cost
        out.append({"id": h.id, "ticker": h.ticker, "name": h.name, "units": float(units), "cost_cents": cost, "value_cents": value,
                    "price_cents": h.price_cents, "price_as_of": h.price_as_of, "priced": priced, "units_missing": missing,
                    "pl_cents": value - cost if priced else None, "dividends_cents": int(divs.get(h.id, 0)),
                    "shariah_note": h.shariah_note, "archived": h.archived})
    return out


# ───────── entries ─────────

def create_entry(db: Session, uid: str, p) -> Entry:
    u = _user(db, uid)
    cat = _own(db, FinCategory, uid, p.category_id, "category")
    _own(db, Pocket, uid, p.from_pocket_id, "pocket")
    _own(db, Pocket, uid, p.to_pocket_id, "pocket")
    _own(db, Holding, uid, p.holding_id, "holding")
    if cat is not None and cat.kind != p.kind:
        raise U(UNPROC, f"That category is for {cat.kind}, not {p.kind}.")
    e = Entry(user_id=uid, kind=p.kind, amount_cents=p.amount_cents, occurred_on=p.occurred_on or _today(u), note=p.note,
              category_id=p.category_id, from_pocket_id=p.from_pocket_id, to_pocket_id=p.to_pocket_id,
              holding_id=p.holding_id, units=p.units, recurring=p.recurring)
    db.add(e)
    try:
        db.commit()
    except IntegrityError as ex:
        db.rollback()
        raise U(UNPROC, "That combination doesn't make sense (e.g. an expense needs a category and a pocket to pay from; a contribution needs a holding).") from ex
    db.refresh(e)
    return e


def list_entries(db: Session, uid: str, month: str | None) -> list[Entry]:
    u = _user(db, uid)
    s, n = month_bounds(month, _today(u))
    return list(db.execute(select(Entry).where(Entry.user_id == uid, Entry.occurred_on >= s, Entry.occurred_on < n)
                           .order_by(Entry.occurred_on.desc(), Entry.created_at.desc())).scalars().all())


def update_entry(db: Session, uid: str, entry_id: str, p) -> Entry:
    """Replace an entry's fields (same validation as create)."""
    u = _user(db, uid)
    e = _own(db, Entry, uid, entry_id, "entry")
    cat = _own(db, FinCategory, uid, p.category_id, "category")
    _own(db, Pocket, uid, p.from_pocket_id, "pocket")
    _own(db, Pocket, uid, p.to_pocket_id, "pocket")
    _own(db, Holding, uid, p.holding_id, "holding")
    if cat is not None and cat.kind != p.kind:
        raise U(UNPROC, f"That category is for {cat.kind}, not {p.kind}.")
    for k in ("kind", "amount_cents", "note", "category_id", "from_pocket_id", "to_pocket_id", "holding_id", "units", "recurring"):
        setattr(e, k, getattr(p, k))
    e.occurred_on = p.occurred_on or _today(u)
    try:
        db.commit()
    except IntegrityError as ex:
        db.rollback()
        raise U(UNPROC, "That combination doesn't make sense (e.g. an expense needs a category and a pocket to pay from).") from ex
    db.refresh(e)
    return e


def delete_entry(db: Session, uid: str, entry_id: str) -> None:
    e = _own(db, Entry, uid, entry_id, "entry")
    db.delete(e)
    db.commit()


# ───────── generic CRUD helpers for small tables ─────────

def create_row(db: Session, model, uid: str, data: dict, dup_msg: str):
    _user(db, uid)
    row = model(user_id=uid, **data)
    db.add(row)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise U(status.HTTP_409_CONFLICT, dup_msg) from e
    db.refresh(row)
    return row


def patch_row(db: Session, row, data: dict, dup_msg: str):
    for k, v in data.items():
        setattr(row, k, v)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise U(status.HTTP_409_CONFLICT, dup_msg) from e
    db.refresh(row)
    return row


def delete_row(db: Session, row, blocked_msg: str) -> None:
    db.delete(row)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise U(status.HTTP_409_CONFLICT, blocked_msg) from e


# ───────── work hours → income ─────────

def _hours(sh_start: datetime, sh_end: datetime, job: Job | None, tz: ZoneInfo) -> float:
    mins = (sh_end - sh_start).total_seconds() / 60
    if job and job.unpaid_break_minutes and mins >= job.break_after_minutes:
        mins -= job.unpaid_break_minutes
    return max(0.0, mins) / 60


def work_income(db: Session, u: User, start: date, nxt: date) -> dict:
    tz = ZoneInfo(u.timezone)
    ws, we = datetime(start.year, start.month, start.day, tzinfo=tz), datetime(nxt.year, nxt.month, nxt.day, tzinfo=tz)
    rows = db.execute(
        select(Shift, Commitment, Job).join(Commitment, Shift.commitment_id == Commitment.id)
        .outerjoin(Job, Shift.job_id == Job.id).where(Commitment.user_id == u.id, Commitment.status.notin_(("skipped", "archived")))
    ).all()
    hours = pay = 0.0
    done_hours = 0.0
    tpl = {c.id: (s, j) for s, c, j in rows if c.recurrence_rule is not None}
    for s, c, j in rows:
        if c.recurrence_rule is None and c.start_at and ws <= c.start_at < we:
            h = _hours(c.start_at, c.end_at, j, tz)
            rate = float(s.hourly_rate_override if s.hourly_rate_override is not None else (j.hourly_rate if j and j.hourly_rate else 0))
            hours += h
            pay += h * rate if not (j and j.pay_basis == "monthly") else 0
            if c.status == "completed":
                done_hours += h
    if tpl:
        for v in virtual_occurrences(db, u, ws, we):
            if v.template.id in tpl:
                s, j = tpl[v.template.id]
                h = _hours(v.occurrence.start_at, v.occurrence.end_at, j, tz)
                rate = float(s.hourly_rate_override if s.hourly_rate_override is not None else (j.hourly_rate if j and j.hourly_rate else 0))
                hours += h
                pay += h * rate if not (j and j.pay_basis == "monthly") else 0
    monthly = sum(float(j.monthly_pay or 0) for j in db.execute(select(Job).where(Job.user_id == u.id, Job.pay_basis == "monthly")).scalars())
    return {"scheduled_hours": round(hours, 2), "completed_hours": round(done_hours, 2),
            "expected_hourly_pay_cents": int(round(pay * 100)), "monthly_pay_cents": int(round(monthly * 100))}


def expected_income(db: Session, u: User, start: date, nxt: date) -> dict:
    terms = list_terms(db, u.id)
    mid = start.replace(day=15)
    cover = next((t for t in terms if t.start_date <= mid <= t.end_date), None)
    known = cover is not None
    in_break = cover is not None and cover.kind == "break"
    src = db.execute(select(IncomeSource).where(IncomeSource.user_id == u.id, IncomeSource.active.is_(True))).scalars().all()
    items = []
    for s in src:
        pays = s.pays_in_break if in_break else s.pays_in_term
        items.append({"name": s.name, "kind": s.kind, "cents": s.monthly_cents if pays else 0,
                      "note": ("not paid during breaks" if (in_break and not s.pays_in_break) else None) if known else "term dates not entered — assumed paid"})
    w = work_income(db, u, start, nxt)
    return {"items": items, "work": w, "term_kind": cover.kind if cover else None,
            "total_cents": sum(i["cents"] for i in items) + w["expected_hourly_pay_cents"] + w["monthly_pay_cents"]}


# ───────── dashboard ─────────

def hourly_rate_cents(db: Session, uid: str) -> int | None:
    """Your hourly pay in cents: your main job if it pays by the hour, else the best-paid hourly job. None if there is none."""
    from app.models.user import Job
    jobs = list(db.execute(select(Job).where(Job.user_id == uid)).scalars())
    paid = lambda j: j.pay_basis == "hourly" and j.hourly_rate and float(j.hourly_rate) > 0
    main = next((j for j in jobs if j.is_main), None)
    if main is not None and paid(main):
        return int(round(float(main.hourly_rate) * 100))
    rates = [float(j.hourly_rate) for j in jobs if paid(j)]
    return int(round(max(rates) * 100)) if rates else None


def dashboard(db: Session, uid: str, month: str | None) -> dict:
    u = _user(db, uid)
    today = _today(u)
    start, nxt = month_bounds(month, today)
    prev_start = _prev(start)
    cur = u.currency
    rs = current_rules(db, uid)
    cfg = rs.config
    pockets = list(db.execute(select(Pocket).where(Pocket.user_id == uid, Pocket.archived.is_(False)).order_by(Pocket.created_at)).scalars())
    prole = {p.id: p for p in pockets}
    cats = {c.id: c for c in db.execute(select(FinCategory).where(FinCategory.user_id == uid)).scalars()}
    # balances at the *end* of the viewed month (so past months are viewable)
    bal = pocket_balances(db, uid, upto=nxt)
    pocket_rows = [{"id": p.id, "name": p.name, "role": p.role, "purpose": p.purpose, "provider": p.provider, "is_liquid": p.is_liquid,
                    "balance_cents": bal.get(p.id, 0)} for p in pockets]
    total_cash = sum(r["balance_cents"] for r in pocket_rows)
    liquid = sum(r["balance_cents"] for r in pocket_rows if r["is_liquid"])
    by_purpose = defaultdict(int)
    for r in pocket_rows:
        by_purpose[r["purpose"]] += r["balance_cents"]

    since = _prev(_prev(_prev(start)))   # three months back for pace
    entries = list(db.execute(select(Entry).where(Entry.user_id == uid, Entry.occurred_on >= since, Entry.occurred_on < nxt)).scalars())
    in_month = lambda e, s, n: s <= e.occurred_on < n  # noqa: E731

    def month_stats(s: date, n: date) -> dict:
        income = div = spent_cap = spent_all = contrib = save_delta = 0
        by_cat: dict[str, int] = defaultdict(int)
        alloc_actual: dict[str, int] = defaultdict(int)
        withdrawals = 0
        for e in entries:
            if not in_month(e, s, n):
                continue
            fp, tp = prole.get(e.from_pocket_id), prole.get(e.to_pocket_id)
            if e.kind == "income":
                income += e.amount_cents
            elif e.kind == "dividend":
                div += e.amount_cents
            elif e.kind == "expense":
                c = cats.get(e.category_id)
                spent_all += e.amount_cents
                if c is None or c.counts_toward_cap:
                    spent_cap += e.amount_cents
                by_cat[c.name if c else "Uncategorised"] += e.amount_cents
                if fp and fp.role == "savings":
                    withdrawals += e.amount_cents
            elif e.kind == "contribution":
                contrib += e.amount_cents
                alloc_actual["investments"] += e.amount_cents
            # savings role movement (transfers among savings pockets don't count)
            to_s = bool(tp and tp.role == "savings")
            from_s = bool(fp and fp.role == "savings")
            if to_s and not from_s and e.kind in ("income", "transfer", "dividend"):
                save_delta += e.amount_cents
            if from_s and not to_s and e.kind in ("transfer",):
                save_delta -= e.amount_cents
            if from_s and e.kind == "expense":
                save_delta -= e.amount_cents
            # allocation actuals
            if tp and e.kind in ("income", "transfer") and not (fp and fp.purpose == tp.purpose):
                alloc_actual[f"p:{tp.purpose}"] += e.amount_cents
            if fp and e.kind == "transfer" and tp is not None and fp.role == "savings" and tp.role != "savings":
                alloc_actual[f"p:{fp.purpose}"] -= e.amount_cents
        alloc_actual["spending"] = spent_cap
        return {"income": income, "dividends": div, "spent_cap": spent_cap, "spent_all": spent_all, "contrib": contrib,
                "savings": save_delta, "by_cat": dict(by_cat), "alloc": dict(alloc_actual), "withdrawals": withdrawals}

    now_s, prev_s = month_stats(start, nxt), month_stats(prev_start, start)
    inc_total = now_s["income"] + now_s["dividends"]
    rate = lambda s: ((s["savings"] / (s["income"] + s["dividends"])) if (s["income"] + s["dividends"]) > 0 else None)  # noqa: E731
    rate_now, rate_prev = rate(now_s), rate(prev_s)
    inv_rate = (now_s["contrib"] / inc_total) if inc_total > 0 else None
    comb = ((now_s["savings"] + now_s["contrib"]) / inc_total) if inc_total > 0 else None

    # liquidity + portfolio
    liq = eng.liquidity(liquid, cfg["liquidity_floor_cents"], cfg.get("liquidity_comfort_cents"), cur)
    pos = [p for p in holding_positions(db, uid) if not p["archived"] or p["value_cents"] > 0]
    port = eng.portfolio_rows([{"ticker": p["ticker"], "value_cents": p["value_cents"], "priced": p["priced"]} for p in pos],
                              cfg["portfolio"], cfg.get("tolerance_pp", 5))
    pos_by = {p["ticker"]: p for p in pos}
    for r in port["rows"]:
        p = pos_by.get(r["ticker"])
        r["cost_cents"] = p["cost_cents"] if p else 0
        r["pl_cents"] = p["pl_cents"] if p else None
        r["units"] = p["units"] if p else 0
        r["price_cents"] = p["price_cents"] if p else None
        r["price_as_of"] = p["price_as_of"] if p else None
        r["units_missing"] = p["units_missing"] if p else False
        r["holding_id"] = p["id"] if p else None
    invest_value = port["total_cents"]
    invest_cost = sum(p["cost_cents"] for p in pos)
    amount = cfg["min_contribution_cents"]
    suggestion = []
    if cfg["conditions"].get("underweight_first", True) and cfg["portfolio"]:
        suggestion = eng.suggest_contribution(port["rows"], port["total_cents"], amount)
    hold_cash_first = cfg["conditions"].get("liquidity_first", True) and liq["priority"] == "cash"

    # net worth
    items = list(db.execute(select(BalanceItem).where(BalanceItem.user_id == uid)).scalars())
    other_assets = sum(i.balance_cents for i in items if i.kind == "asset")
    liabilities = sum(i.balance_cents for i in items if i.kind == "liability")
    net_worth = total_cash + invest_value + other_assets - liabilities
    if start == today.replace(day=1):
        snap = db.execute(select(Snapshot).where(Snapshot.user_id == uid, Snapshot.month == start)).scalar_one_or_none()
        if snap is None:
            db.add(Snapshot(user_id=uid, month=start, net_worth_cents=net_worth, cash_cents=total_cash, investments_cents=invest_value))
        else:
            snap.net_worth_cents, snap.cash_cents, snap.investments_cents = net_worth, total_cash, invest_value
            snap.updated_at = datetime.now(timezone.utc)
        db.commit()

    # allocation
    alloc_lines = cfg["allocation"]
    actual: dict[str, int] = {}
    for l in alloc_lines:
        if l["source"] == "spending":
            actual[l["key"]] = now_s["spent_cap"]
        elif l["source"] == "investment":
            actual[l["key"]] = now_s["contrib"]
        else:
            actual[l["key"]] = now_s["alloc"].get(f"p:{l.get('purpose')}", 0)
    redirect = None
    if hold_cash_first:
        to = cfg["conditions"].get("redirect_to", "emergency")
        inv_key = next((l["key"] for l in alloc_lines if l["source"] == "investment"), None)
        if inv_key and any(l["key"] == to for l in alloc_lines):
            redirect = (inv_key, to)
    allocation = eng.allocation_lines(alloc_lines, inc_total, actual, redirect)

    # goals
    goals_out = []
    three_ago = _prev(_prev(start))
    for g in db.execute(select(FinGoal).where(FinGoal.user_id == uid, FinGoal.archived.is_(False)).order_by(FinGoal.created_at)).scalars():
        if g.kind == "pocket":
            current = max(0, bal.get(g.pocket_id, 0))
            pace = 0
            for e in entries:
                if e.occurred_on >= three_ago and e.to_pocket_id == g.pocket_id and e.from_pocket_id != g.pocket_id:
                    pace += e.amount_cents
                if e.occurred_on >= three_ago and e.from_pocket_id == g.pocket_id:
                    pace -= e.amount_cents
            pace = max(0, pace) // 3
        elif g.kind == "investments":
            current, pace = invest_value, 0
            pace = sum(e.amount_cents for e in entries if e.kind == "contribution" and e.occurred_on >= three_ago) // 3
        elif g.kind == "net_worth":
            current, pace = max(0, net_worth), 0
        else:
            current, pace = g.manual_current_cents or 0, 0
        m = eng.goal_metrics(g.target_cents, current, g.target_date, pace, g.planned_monthly_cents, today)
        goals_out.append({"id": g.id, "title": g.title, "kind": g.kind, "pocket_id": g.pocket_id, "target_date": g.target_date, **m})

    # milestones
    mss = [{"age": m.age, "nw_low_cents": m.nw_low_cents, "nw_high_cents": m.nw_high_cents, "note": m.note}
           for m in db.execute(select(Milestone).where(Milestone.user_id == uid).order_by(Milestone.age)).scalars()]
    age = eng.age_on(u.birth_date, today) if u.birth_date else None
    milestone = eng.milestone_status(net_worth, age, mss) if age is not None else None

    eff_cap, cap_cut = cap_for_month(db, uid, start, cfg["spending_cap_cents"])
    warns = eng.build_warnings(
        cap_cents=eff_cap, spent_cents=now_s["spent_cap"], cap_on=cfg["conditions"].get("cap_warning", True), liq=liq,
        drift_pp=port["max_drift_pp"], tolerance_pp=cfg.get("tolerance_pp", 5), portfolio_total=port["total_cents"], goals=goals_out,
        rate_now=rate_now, rate_prev=rate_prev, contrib_this=now_s["contrib"], contrib_prev=prev_s["contrib"],
        min_contribution=cfg["min_contribution_cents"], day_of_month=today.day, cur=cur)
    if now_s["withdrawals"] > 0:
        warns.append({"code": "withdrawal", "level": "warn", "text": f"{eng.money(now_s['withdrawals'], cur)} was spent straight out of a savings pocket this month."})
    if allocation["unset"]:
        warns.append({"code": "alloc_unset", "level": "info", "text": "Your allocation percentages aren't set yet — add them under Rules to see targets."})
    if age is None:
        warns.append({"code": "no_birth", "level": "info", "text": "Add your date of birth under Rules to compare net worth with your age milestones."})

    exp = expected_income(db, u, start, nxt)
    cap = eff_cap
    return {
        "month": start.strftime("%Y-%m"), "currency": cur, "today": today, "hourly_rate_cents": hourly_rate_cents(db, uid),
        "income_cents": now_s["income"], "dividends_cents": now_s["dividends"], "expected_income": exp,
        "spending_cents": now_s["spent_cap"], "spending_all_cents": now_s["spent_all"], "cap_cents": cap, "cap_base_cents": cfg["spending_cap_cents"], "cap_cut_cents": cap_cut,
        "cap_used": round(now_s["spent_cap"] / cap, 4) if cap > 0 else None, "spending_by_category": now_s["by_cat"],
        "savings_cents": now_s["savings"], "investment_cents": now_s["contrib"], "savings_rate": rate_now, "investment_rate": inv_rate,
        "save_invest_rate": comb, "save_invest_target": cfg["save_invest_target"], "min_contribution_cents": cfg["min_contribution_cents"],
        "pockets": pocket_rows, "total_cash_cents": total_cash, "liquid_cash_cents": liquid,
        "emergency_cents": by_purpose.get("emergency", 0), "travel_cents": by_purpose.get("travel", 0),
        "liquidity": liq, "invest_priority": "cash" if hold_cash_first else "invest",
        "portfolio": {**port, "cost_cents": invest_cost, "pl_cents": invest_value - invest_cost if any(p["priced"] for p in pos) else None,
                      "suggestion": suggestion, "suggestion_amount_cents": amount, "suggestion_paused": hold_cash_first,
                      "dividends_cents": sum(p["dividends_cents"] for p in pos)},
        "net_worth_cents": net_worth, "assets_cents": total_cash + invest_value + other_assets, "liabilities_cents": liabilities,
        "other_assets_cents": other_assets, "allocation": allocation, "goals": goals_out, "milestone": milestone, "age": age,
        "warnings": warns, "chain": {"hours": exp["work"]["completed_hours"], "income": inc_total, "saved": now_s["savings"],
                                     "invested": now_s["contrib"], "net_worth": net_worth},
    }


def networth_history(db: Session, uid: str) -> dict:
    u = _user(db, uid)
    snaps = db.execute(select(Snapshot).where(Snapshot.user_id == uid).order_by(Snapshot.month)).scalars().all()
    mss = db.execute(select(Milestone).where(Milestone.user_id == uid).order_by(Milestone.age)).scalars().all()
    return {"snapshots": [{"month": s.month.strftime("%Y-%m"), "net_worth_cents": s.net_worth_cents, "cash_cents": s.cash_cents,
                           "investments_cents": s.investments_cents} for s in snaps],
            "milestones": [{"age": m.age, "nw_low_cents": m.nw_low_cents, "nw_high_cents": m.nw_high_cents} for m in mss],
            "birth_date": u.birth_date}


# ───────── planning ─────────

def plan(db: Session, uid: str, req) -> dict:
    u = _user(db, uid)
    d = dashboard(db, uid, None)
    cat = _own(db, FinCategory, uid, req.category_id, "category")
    if cat.kind != "expense":
        raise U(UNPROC, "Pick an expense category.")
    pocket = _own(db, Pocket, uid, req.pocket_id, "pocket") if req.pocket_id else None
    cfg = current_rules(db, uid).config
    earmarked = bool(pocket and pocket.role == "earmarked")
    pays_liquid = (pocket.is_liquid if pocket else True) and not earmarked
    res = eng.affordability(req.price_cents, cat.counts_toward_cap, d["cap_cents"], d["spending_cents"], d["liquid_cash_cents"],
                            pays_liquid, cfg["liquidity_floor_cents"], d["income_cents"], cfg["min_contribution_cents"], earmarked, u.currency)
    res["name"] = req.name
    if earmarked:
        res["pct_of_month_income"] = None
        res["facts"] = [f for f in res["facts"] if not f.startswith("That is")]
    if pocket is not None:
        have = pocket_balances(db, uid).get(pocket.id, 0)
        if have < req.price_cents:
            res["verdict"] = "insufficient"
            res["flags"].append(f"{pocket.name} only holds {eng.money(have, u.currency)}, which is {eng.money(req.price_cents - have, u.currency)} short.")
        else:
            res["facts"].append(f"{pocket.name} holds {eng.money(have, u.currency)}; {eng.money(have - req.price_cents, u.currency)} would remain.")
    rate = hourly_rate_cents(db, uid)
    res["hourly_rate_cents"] = rate
    res["work_hours"] = round(req.price_cents / rate, 1) if rate else None
    res["investing_note"] = None
    if d["invest_priority"] == "cash":
        res["investing_note"] = "Liquid cash is already under your minimum buffer, so rebuilding cash comes before extra investing."
    return res


# ───────── scenarios ─────────

def run_scenario(kind: str, params: dict, d_defaults: dict | None = None) -> dict:
    from app.schemas.fin import GrowthParams, PropertyParams
    if kind == "growth":
        p = GrowthParams(**params)
        return {"paths": [{"rate_pct": r, **eng.scenario_growth(p.start_cents, p.monthly_cents, r, p.years)} for r in p.rates_pct]}
    p = PropertyParams(**params)
    cash = (d_defaults or {}).get("total_cash_cents", 0) + (d_defaults or {}).get("invest_value_cents", 0)
    return eng.scenario_property(p.price_cents, p.down_pct, p.loan_rate_pct, p.tenure_years, cash, p.monthly_save_cents)


# ───────── wishlist ─────────

def list_wishlist(db: Session, uid: str) -> list[dict]:
    """Each item is re-checked against today's rules, so 'not yet' can turn into 'fits' later."""
    _user(db, uid)
    items = db.execute(select(WishlistItem).where(WishlistItem.user_id == uid, WishlistItem.archived.is_(False))
                       .order_by(WishlistItem.created_at)).scalars().all()
    out = []
    rate = hourly_rate_cents(db, uid)
    for w in items:
        class R:  # minimal PlanReq
            name, price_cents, category_id, pocket_id = w.name, w.price_cents, w.category_id, None
        try:
            r = plan(db, uid, R)
            verdict, flags = r["verdict"], r["flags"]
        except HTTPException:
            verdict, flags = "fits", []
        out.append({"id": w.id, "name": w.name, "price_cents": w.price_cents, "category_id": w.category_id,
                    "note": w.note, "verdict": verdict, "flags": flags,
                    "work_hours": round(w.price_cents / rate, 1) if rate else None})
    return out
