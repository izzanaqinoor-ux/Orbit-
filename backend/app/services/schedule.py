"""Planets (user-defined categories) and school terms/breaks."""
from dataclasses import dataclass
from datetime import date, time, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.commitment import Commitment
from app.models.schedule import PLANET_COLORS, PLANET_KINDS, Occasion, Planet, SchoolTerm

DEFAULT_PLANETS = [("Study", "study", "study"), ("Work", "work", "work"), ("Personal", "personal", "personal"), ("Other", "other", "other")]


def seed_planets(db: Session, user_id: str) -> None:
    for name, kind, color in DEFAULT_PLANETS:
        db.add(Planet(user_id=user_id, name=name, kind=kind, color=color))


def list_planets(db: Session, user_id: str) -> list[Planet]:
    return list(db.execute(select(Planet).where(Planet.user_id == user_id).order_by(Planet.created_at, Planet.name)).scalars().all())


def get_planet(db: Session, user_id: str, planet_id: str) -> Planet | None:
    return db.execute(select(Planet).where(Planet.id == planet_id, Planet.user_id == user_id)).scalar_one_or_none()


def _check(name: str | None, kind: str | None, color: str | None) -> None:
    if name is not None and not name.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A planet needs a name.")
    if kind is not None and kind not in PLANET_KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"kind must be one of {PLANET_KINDS}")
    if color is not None and color not in PLANET_COLORS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"color must be one of {PLANET_COLORS}")


def create_planet(db: Session, user_id: str, name: str, kind: str, color: str) -> Planet:
    _check(name, kind, color)
    p = Planet(user_id=user_id, name=name.strip(), kind=kind, color=color)
    db.add(p)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "You already have a planet with that name.") from e
    db.refresh(p)
    return p


def update_planet(db: Session, p: Planet, name: str | None, color: str | None) -> Planet:
    _check(name, None, color)
    if name is not None:
        p.name = name.strip()
    if color is not None:
        p.color = color
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "You already have a planet with that name.") from e
    db.refresh(p)
    return p


def delete_planet(db: Session, p: Planet) -> None:
    """Allowed only when nothing active uses it. Finished/archived history keeps its
    kind (the FK nulls planet_id), so past weeks still read correctly."""
    active = db.execute(
        select(Commitment.id).where(
            Commitment.planet_id == p.id, Commitment.user_id == p.user_id,
            Commitment.status.in_(("todo", "in_progress")),
        ).limit(1)
    ).scalar_one_or_none()
    if active is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Something active still lives on this planet. Finish, archive or move those commitments first.",
        )
    db.delete(p)
    db.commit()


# ── school terms ──

def list_terms(db: Session, user_id: str) -> list[SchoolTerm]:
    return list(db.execute(select(SchoolTerm).where(SchoolTerm.user_id == user_id).order_by(SchoolTerm.start_date)).scalars().all())


def _overlaps(db: Session, user_id: str, start: date, end: date, ignore_id: str | None = None) -> bool:
    q = select(SchoolTerm.id).where(SchoolTerm.user_id == user_id, SchoolTerm.start_date <= end, SchoolTerm.end_date >= start)
    if ignore_id:
        q = q.where(SchoolTerm.id != ignore_id)
    return db.execute(q.limit(1)).scalar_one_or_none() is not None


def create_term(db: Session, user_id: str, kind: str, name: str, start: date, end: date) -> SchoolTerm:
    if kind not in ("term", "break"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "kind must be 'term' or 'break'")
    if end < start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The end date is before the start date.")
    if _overlaps(db, user_id, start, end):
        raise HTTPException(status.HTTP_409_CONFLICT, "That overlaps a term or break you've already entered.")
    t = SchoolTerm(user_id=user_id, kind=kind, name=name.strip() or ("Term" if kind == "term" else "Break"), start_date=start, end_date=end)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def delete_term(db: Session, user_id: str, term_id: str) -> None:
    t = db.execute(select(SchoolTerm).where(SchoolTerm.id == term_id, SchoolTerm.user_id == user_id)).scalar_one_or_none()
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    db.delete(t)
    db.commit()


@dataclass
class TermStatus:
    current: SchoolTerm | None
    next: SchoolTerm | None
    needs_input: bool
    message: str | None


def term_status(terms: list[SchoolTerm], today: date) -> TermStatus:
    """
    Reminder logic. The user enters terms yearly-by-hand because the dates change:
    - nothing entered at all, or everything entered is in the past  -> ask
    - currently in a break and no later term entered                -> ask for the next term
    - the last thing entered ends within 14 days                    -> gentle heads-up
    """
    current = next((t for t in terms if t.start_date <= today <= t.end_date), None)
    future = [t for t in terms if t.start_date > today]
    nxt = future[0] if future else None
    if not terms or all(t.end_date < today for t in terms):
        return TermStatus(None, None, True, "Add your busy periods and time off so Orbit can colour your calendar and know when income applies.")
    if (current is None or current.kind == "break") and not any(t.kind == "term" for t in future):
        return TermStatus(current, nxt, True, "You're in a time-off period and your next busy period isn't entered yet. Add it when you know the dates.")
    last_end = max(t.end_date for t in terms)
    if last_end - today <= timedelta(days=14):
        return TermStatus(current, nxt, True, f"Your last entered period ends on {last_end:%d %b}. Add what comes next when you know it.")
    return TermStatus(current, nxt, False, None)


# ───────── occasions (rare, important days) ─────────

def _on_year(d: date, year: int) -> date:
    try:
        return d.replace(year=year)
    except ValueError:        # 29 Feb in a non-leap year
        return date(year, 2, 28)


def list_occasions(db: Session, user_id: str, start: date, end: date) -> list[dict]:
    """Every occurrence in [start, end], with yearly ones expanded."""
    out = []
    for o in db.execute(select(Occasion).where(Occasion.user_id == user_id)).scalars():
        dates = [o.occurs_on] if not o.repeats_yearly else [_on_year(o.occurs_on, y) for y in range(start.year, end.year + 1)]
        for d in dates:
            if start <= d <= end and d >= o.occurs_on:
                out.append({"id": o.id, "title": o.title, "date": d, "time": o.occurs_time, "repeats_yearly": o.repeats_yearly, "note": o.note,
                            "years": (d.year - o.occurs_on.year) if o.repeats_yearly else None})
    return sorted(out, key=lambda x: (x["date"], x["time"] or time(0)))


def create_occasion(db: Session, user_id: str, title: str, on: date, at: time | None, yearly: bool, note: str | None) -> Occasion:
    if not title.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Give it a name.")
    o = Occasion(user_id=user_id, title=title.strip(), occurs_on=on, occurs_time=at, repeats_yearly=yearly, note=(note or None))
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


def delete_occasion(db: Session, user_id: str, occasion_id: str) -> None:
    o = db.execute(select(Occasion).where(Occasion.id == occasion_id, Occasion.user_id == user_id)).scalar_one_or_none()
    if o is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Occasion not found")
    db.delete(o)
    db.commit()
