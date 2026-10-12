"""Exam focus, weekly review and data export. Plain facts only; nothing here tells you what to do."""
import csv
import io
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import Base
from app.models.commitment import Commitment
from app.models.extensions import CommitmentException, Exam
from app.models.fin import Entry, FinCategory, Pocket
from app.models.time_block import TimeBlock
from app.models.user import User
from app.services import fin as F
from app.services import fin_books as FB


def _tz_now(u: User) -> datetime:
    return datetime.now(timezone.utc).astimezone(ZoneInfo(u.timezone))


def exam_focus(db: Session, uid: str) -> dict:
    """Is an exam close enough that Orbit should stay quiet about money? Uses the exam_focus_days setting (0 = never)."""
    u = F._user(db, uid)
    now = _tz_now(u)
    days = u.exam_focus_days
    out = {"active": False, "days": days, "exam": None, "study_hours_planned": 0.0}
    if days <= 0:
        return out
    horizon = now + timedelta(days=days)
    rows = db.execute(
        select(Commitment).join(Exam, Exam.commitment_id == Commitment.id)
        .where(Commitment.user_id == uid, Commitment.status.in_(("todo", "in_progress")),
               Commitment.start_at.is_not(None), Commitment.start_at <= horizon,
               Commitment.end_at >= now)
        .order_by(Commitment.start_at)).scalars().all()
    if not rows:
        return out
    c = rows[0]
    start = c.start_at
    study = db.execute(
        select(TimeBlock, Commitment).join(Commitment, Commitment.id == TimeBlock.commitment_id)
        .where(Commitment.user_id == uid, Commitment.category == "study", TimeBlock.status == "planned",
               TimeBlock.start_at >= now, TimeBlock.start_at < start)).all()
    mins = sum((tb.end_at - tb.start_at).total_seconds() / 60 for tb, _ in study)
    out.update(active=True, study_hours_planned=round(mins / 60, 1),
               exam={"id": c.id, "title": c.title, "start_at": start,
                     "days_away": max(0, (start.date() - now.date()).days)})
    return out


def review(db: Session, uid: str, week_start: date | None) -> dict:
    u = F._user(db, uid)
    today = F._today(u)
    ws = FB.week_summary(db, uid, week_start)
    monday, nxt = ws["week_start"], ws["week_end"] + timedelta(days=1)
    tz = ZoneInfo(u.timezone)
    lo, hi = datetime.combine(monday, datetime.min.time(), tzinfo=tz), datetime.combine(nxt, datetime.min.time(), tzinfo=tz)
    cs = {c.id: c for c in db.execute(select(Commitment).where(Commitment.user_id == uid)).scalars()}
    blocks = db.execute(select(TimeBlock).join(Commitment, Commitment.id == TimeBlock.commitment_id)
                        .where(Commitment.user_id == uid, TimeBlock.status == "completed",
                               TimeBlock.start_at >= lo, TimeBlock.start_at < hi)).scalars().all()
    by_kind: dict[str, float] = defaultdict(float)
    for b in blocks:
        mins = b.actual_duration_minutes if b.actual_duration_minutes is not None else (b.end_at - b.start_at).total_seconds() / 60
        by_kind[cs[b.commitment_id].category] += mins / 60
    done = [c for c in cs.values() if c.status == "completed" and c.completed_at and lo <= c.completed_at < hi
            and c.recurrence_rule is None]
    bal0 = sum(F.pocket_balances(db, uid, upto=monday).values())
    bal1 = sum(F.pocket_balances(db, uid, upto=nxt).values())
    d = F.dashboard(db, uid, None)
    goals = [{"title": g["title"], "progress": g["progress"], "status": g["status"]} for g in d["goals"]]
    return {**ws, "is_current": monday <= today < nxt, "study_hours": round(by_kind.get("study", 0), 1),
            "focused_hours_by_kind": {k: round(v, 1) for k, v in by_kind.items()},
            "done": [{"title": c.title, "category": c.category} for c in sorted(done, key=lambda c: c.completed_at)][:10],
            "done_count": len(done), "cash_change_cents": bal1 - bal0, "cash_end_cents": bal1, "goals": goals,
            "can_go_back": True, "can_go_forward": nxt <= today}


def export_json(db: Session, uid: str) -> dict:
    u = F._user(db, uid)
    data: dict = {"exported_at": _tz_now(u), "app": "Orbit", "tables": {}}
    for m in Base.registry.mappers:
        cls = m.class_
        t = cls.__table__
        if t.name == "users":
            rows = [u]
        elif "user_id" in t.c:
            rows = db.execute(select(cls).where(cls.user_id == uid)).scalars().all()
        elif cls is CommitmentException:
            ids = [c for (c,) in db.execute(select(Commitment.id).where(Commitment.user_id == uid))]
            rows = db.execute(select(cls).where(cls.commitment_id.in_(ids))).scalars().all() if ids else []
        else:
            continue
        cols = [c.key for c in m.column_attrs if c.key != "password_hash"]
        data["tables"][t.name] = [{k: getattr(r, k) for k in cols} for r in rows]
    return jsonable_encoder(data)


def entries_csv(db: Session, uid: str) -> str:
    u = F._user(db, uid)
    cats = {c.id: c.name for c in db.execute(select(FinCategory).where(FinCategory.user_id == uid)).scalars()}
    pk = {p.id: p.name for p in db.execute(select(Pocket).where(Pocket.user_id == uid)).scalars()}
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["date", "type", "amount", "currency", "category", "from_account", "to_account", "note"])
    for e in db.execute(select(Entry).where(Entry.user_id == uid).order_by(Entry.occurred_on, Entry.created_at)).scalars():
        w.writerow([e.occurred_on.isoformat(), e.kind, f"{e.amount_cents / 100:.2f}", u.currency, cats.get(e.category_id, ""),
                    pk.get(e.from_pocket_id, ""), pk.get(e.to_pocket_id, ""), e.note or ""])
    return out.getvalue()
