"""
DB-aware recurrence glue: turns the pure `expand()` output into the set of
occurrences that are *actually* on the user's calendar, and implements
exceptions + materialize-on-touch.

The rule for what appears on the calendar for a template T on date D:
  expansion(T) contains D
  AND no commitment_exception for (T, D)
  AND no materialized row for (T, D)   <- the real row replaces the virtual one
Materialized rows are ordinary fixed Commitments, so they are counted by the
normal fixed-row queries; this module only supplies the *virtual* remainder.
"""
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.commitment import Commitment
from app.models.extensions import CommitmentException
from app.models.user import User
from app.services.recurrence import Occurrence, expand


@dataclass(frozen=True)
class VirtualOccurrence:
    template: Commitment
    occurrence: Occurrence


def _active_templates(db: Session, user_id: str) -> list[Commitment]:
    return list(
        db.execute(
            select(Commitment).where(
                Commitment.user_id == user_id,
                Commitment.recurrence_rule.is_not(None),
                Commitment.status.in_(("todo", "in_progress")),
            )
        ).scalars().all()
    )


def _suppressed_dates(db: Session, template_ids: list[str]) -> set[tuple[str, date]]:
    """(template_id, date) pairs that must NOT appear virtually."""
    if not template_ids:
        return set()
    excepted = db.execute(
        select(CommitmentException.commitment_id, CommitmentException.excluded_date).where(
            CommitmentException.commitment_id.in_(template_ids)
        )
    ).all()
    materialized = db.execute(
        select(Commitment.recurrence_template_id, Commitment.occurrence_date).where(
            Commitment.recurrence_template_id.in_(template_ids)
        )
    ).all()
    return {(t, d) for t, d in excepted} | {(t, d) for t, d in materialized}


def virtual_occurrences(
    db: Session, user: User, window_start: datetime, window_end: datetime
) -> list[VirtualOccurrence]:
    templates = _active_templates(db, user.id)
    suppressed = _suppressed_dates(db, [t.id for t in templates])
    out: list[VirtualOccurrence] = []
    for t in templates:
        for occ in expand(
            t.recurrence_rule, t.start_at, t.end_at, user.timezone,
            window_start, window_end, t.recurrence_end_date,
        ):
            if (t.id, occ.occurrence_date) not in suppressed:
                out.append(VirtualOccurrence(t, occ))
    out.sort(key=lambda v: v.occurrence.start_at)
    return out


# --- Exceptions ------------------------------------------------------------

def _require_template(db: Session, user_id: str, commitment_id: str) -> Commitment:
    c = db.execute(
        select(Commitment).where(Commitment.id == commitment_id, Commitment.user_id == user_id)
    ).scalar_one_or_none()
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Commitment not found")
    if c.recurrence_rule is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Exceptions and occurrences only apply to recurrence templates.",
        )
    return c


def _expansion_contains(template: Commitment, user: User, d: date) -> bool:
    # Ask the engine for a window covering just that local day (±1 day pad
    # inside expand handles boundaries) and check the date matches exactly.
    from zoneinfo import ZoneInfo
    tz = ZoneInfo(user.timezone)
    start = datetime(d.year, d.month, d.day, tzinfo=tz)
    occs = expand(
        template.recurrence_rule, template.start_at, template.end_at, user.timezone,
        start, start + timedelta(days=1), template.recurrence_end_date,
    )
    return any(o.occurrence_date == d for o in occs)


def add_exception(db: Session, user: User, template_id: str, d: date) -> CommitmentException:
    template = _require_template(db, user.id, template_id)
    if not _expansion_contains(template, user, d):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{d} is not an occurrence date of this template.")
    already = db.execute(
        select(Commitment.id).where(
            Commitment.recurrence_template_id == template.id, Commitment.occurrence_date == d
        )
    ).scalar_one_or_none()
    if already is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "That occurrence has already been materialized; archive or skip the occurrence itself instead.",
        )
    exc = CommitmentException(commitment_id=template.id, excluded_date=d)
    db.add(exc)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Exception already exists for that date.") from e
    db.refresh(exc)
    return exc


def list_exceptions(db: Session, user_id: str, template_id: str) -> list[CommitmentException]:
    template = _require_template(db, user_id, template_id)
    return list(
        db.execute(
            select(CommitmentException)
            .where(CommitmentException.commitment_id == template.id)
            .order_by(CommitmentException.excluded_date)
        ).scalars().all()
    )


def remove_exception(db: Session, user_id: str, template_id: str, d: date) -> None:
    template = _require_template(db, user_id, template_id)
    exc = db.execute(
        select(CommitmentException).where(
            CommitmentException.commitment_id == template.id, CommitmentException.excluded_date == d
        )
    ).scalar_one_or_none()
    if exc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No exception on that date")
    db.delete(exc)
    db.commit()


# --- Materialize-on-touch ---------------------------------------------------

def materialize(db: Session, user: User, template_id: str, d: date) -> Commitment:
    """
    Turns one virtual occurrence into a real fixed Commitment, so it can be
    completed / skipped / edited independently of the pattern. The new row has
    recurrence_rule NULL (so it counts as real occupancy) and points back at
    the template (chk_recurrence_role, third branch).
    """
    template = _require_template(db, user.id, template_id)
    if template.status not in ("todo", "in_progress"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Template is archived.")

    from zoneinfo import ZoneInfo
    tz = ZoneInfo(user.timezone)
    day_start = datetime(d.year, d.month, d.day, tzinfo=tz)
    occs = [
        o for o in expand(
            template.recurrence_rule, template.start_at, template.end_at, user.timezone,
            day_start, day_start + timedelta(days=1), template.recurrence_end_date,
        ) if o.occurrence_date == d
    ]
    if not occs:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{d} is not an occurrence date of this template.")
    excepted = db.execute(
        select(CommitmentException.id).where(
            CommitmentException.commitment_id == template.id, CommitmentException.excluded_date == d
        )
    ).scalar_one_or_none()
    if excepted is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "That date has an exception (cancelled); remove it first.")

    occ = occs[0]
    row = Commitment(
        user_id=user.id,
        title=template.title,
        description=template.description,
        mode="fixed",
        category=template.category,
        planet_id=template.planet_id,
        priority=template.priority,
        goal_id=template.goal_id,
        start_at=occ.start_at,
        end_at=occ.end_at,
        recurrence_rule=None,
        recurrence_end_date=None,
        recurrence_template_id=template.id,
        occurrence_date=d,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "That occurrence is already materialized.") from e
    db.refresh(row)
    return row
