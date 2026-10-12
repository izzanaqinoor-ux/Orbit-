"""
Service-layer logic for Commitments — the home for the application-enforced
rules Part A of the spec explicitly assigns here rather than to the
database (status-transition validity, the archive-vs-delete gate). CRUD
that's purely mechanical stays in the router; anything that's really a
business rule lives here so it isn't silently reimplemented differently
in a second call site later.
"""
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.mutation import touch_updated_at
from app.models.commitment import Commitment
from app.models.time_block import TimeBlock
from app.schemas.commitment import CommitmentCreateFixed, CommitmentCreateFlexible, CommitmentUpdate


def create_commitment(
    db: Session,
    user_id: str,
    payload: CommitmentCreateFixed | CommitmentCreateFlexible,
) -> Commitment:
    """
    Maps the discriminated create schema onto a Commitment row. The
    fixed/flexible field split is already guaranteed by which schema
    variant validated successfully (Part A, chk_mode_fields) — this
    function's job is just the mechanical translation, not re-checking
    that split.
    """
    category = payload.category
    if payload.planet_id is not None:
        from app.services.schedule import get_planet
        planet = get_planet(db, user_id, payload.planet_id)
        if planet is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown planet.")
        category = planet.kind
    if payload.mode == "fixed":
        commitment = Commitment(
            user_id=user_id,
            title=payload.title,
            description=payload.description,
            mode="fixed",
            category=category,
            planet_id=payload.planet_id,
            priority=payload.priority,
            goal_id=payload.goal_id,
            time_off=payload.time_off,
            start_at=payload.start_at,
            end_at=payload.end_at,
            recurrence_rule=payload.recurrence_rule,
            recurrence_end_date=payload.recurrence_end_date,
        )
    else:
        commitment = Commitment(
            user_id=user_id,
            title=payload.title,
            description=payload.description,
            mode="flexible",
            category=category,
            planet_id=payload.planet_id,
            priority=payload.priority,
            goal_id=payload.goal_id,
            estimated_duration_minutes=payload.estimated_duration_minutes,
            due_at=payload.due_at,
            due_all_day=payload.due_all_day,
        )

    db.add(commitment)
    db.commit()
    db.refresh(commitment)
    return commitment


def update_commitment(db: Session, user_id: str, c: Commitment, payload: CommitmentUpdate) -> Commitment:
    """Edit in place. Fixed commitments take times; flexible ones take effort and a due date. A repeating
    commitment's time edits apply to every occurrence that has not been changed individually."""
    sent = payload.model_fields_set
    bad = lambda msg: HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=msg)
    if c.mode == "fixed" and sent & {"estimated_duration_minutes", "due_at", "due_all_day"}:
        raise bad("A fixed commitment has times, not effort or a due date.")
    if c.mode == "flexible" and sent & {"start_at", "end_at"}:
        raise bad("A flexible commitment has no set time; plan time for it instead.")
    if "title" in sent:
        if not (payload.title or "").strip():
            raise bad("A title is needed.")
        c.title = payload.title.strip()
    if "description" in sent:
        c.description = payload.description
    if "time_off" in sent and payload.time_off is not None:
        if payload.time_off and c.mode != "fixed":
            raise bad("Only a fixed commitment can be time off.")
        c.time_off = payload.time_off
    if "priority" in sent and payload.priority is not None:
        c.priority = payload.priority
    if "planet_id" in sent and payload.planet_id is not None:
        from app.services.schedule import get_planet
        planet = get_planet(db, user_id, payload.planet_id)
        if planet is None:
            raise bad("Unknown planet.")
        c.planet_id, c.category = payload.planet_id, planet.kind
    if c.mode == "fixed":
        s = payload.start_at if "start_at" in sent and payload.start_at else c.start_at
        e = payload.end_at if "end_at" in sent and payload.end_at else c.end_at
        if e <= s:
            raise bad("The end must be after the start.")
        c.start_at, c.end_at = s, e
    else:
        if "estimated_duration_minutes" in sent and payload.estimated_duration_minutes is not None:
            c.estimated_duration_minutes = payload.estimated_duration_minutes
        if "due_at" in sent:
            c.due_at = payload.due_at
            if payload.due_at is None:
                c.due_all_day = False
        if "due_all_day" in sent and payload.due_all_day is not None:
            if payload.due_all_day and c.due_at is None:
                raise bad("An all-day due date needs a date.")
            c.due_all_day = payload.due_all_day
    touch_updated_at(c)
    db.commit()
    db.refresh(c)
    return c


def list_commitments(db: Session, user_id: str, status_filter: str | None = None) -> list[Commitment]:
    stmt = select(Commitment).where(Commitment.user_id == user_id)
    if status_filter is not None:
        stmt = stmt.where(Commitment.status == status_filter)
    stmt = stmt.order_by(Commitment.created_at.desc())
    return list(db.execute(stmt).scalars().all())


def get_commitment(db: Session, user_id: str, commitment_id: str) -> Commitment | None:
    """
    Scoped by user_id in the query itself, not checked after fetching —
    this is what makes a wrong/forged id belonging to another user
    indistinguishable from a nonexistent one (404, not 403), which is the
    safer failure mode for an ownership check.
    """
    stmt = select(Commitment).where(Commitment.id == commitment_id, Commitment.user_id == user_id)
    return db.execute(stmt).scalar_one_or_none()


# --- Status transitions (application-enforced, per Part A) ----------------
#
# The DB's chk_template_status and chk_completed_at_consistency are the
# real backstop; the checks below exist so a caller gets a clear 4xx with
# an explanation instead of a raw IntegrityError from Postgres.

def _reject_if_template(commitment: Commitment, target_status: str) -> None:
    if commitment.recurrence_rule is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Commitment {commitment.id} is a recurrence template — templates cannot become "
                   f"'{target_status}' (chk_template_status restricts templates to todo/in_progress/archived). "
                   f"Archive the template instead, or transition a materialized occurrence.",
        )


def complete_commitment(db: Session, commitment: Commitment) -> Commitment:
    _reject_if_template(commitment, "completed")
    commitment.status = "completed"
    commitment.completed_at = datetime.now(timezone.utc)
    touch_updated_at(commitment)
    db.commit()
    db.refresh(commitment)
    return commitment


def skip_commitment(db: Session, commitment: Commitment) -> Commitment:
    _reject_if_template(commitment, "skipped")
    commitment.status = "skipped"
    commitment.completed_at = None  # chk_completed_at_consistency requires this
    touch_updated_at(commitment)
    db.commit()
    db.refresh(commitment)
    return commitment


def archive_commitment(db: Session, commitment: Commitment) -> Commitment:
    # No transition guard needed: archived is reachable from every other
    # status (Part A), and completed_at is left exactly as it was — the
    # "unconstrained" branch of chk_completed_at_consistency exists for
    # precisely this case.
    commitment.status = "archived"
    touch_updated_at(commitment)
    db.commit()
    db.refresh(commitment)
    return commitment


def delete_commitment(db: Session, commitment: Commitment) -> None:
    """
    Part K's archive-vs-hard-delete gate: a Commitment with any completed
    TimeBlock must be archived, not deleted — checked here, before the
    delete ever reaches the database, so the failure is a clear 409
    rather than relying on the DB to reject it (nothing in the schema
    actually prevents this at the DB level; CASCADE would silently
    destroy the completed TimeBlocks, which is exactly what this gate
    exists to stop).
    """
    has_completed_time_blocks = db.execute(
        select(TimeBlock.id).where(TimeBlock.commitment_id == commitment.id, TimeBlock.status == "completed").limit(1)
    ).scalar_one_or_none()
    if has_completed_time_blocks is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This Commitment has completed TimeBlocks and cannot be hard-deleted — archive it instead "
                   "(PATCH .../archive). Deleting would destroy real completed-work history (Part K).",
        )

    db.delete(commitment)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        # Most likely cause: this is a recurrence template with materialized
        # occurrences still referencing it (fk_template_same_user RESTRICT).
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This Commitment cannot be deleted — it is likely a recurrence template with materialized "
                   "occurrences still referencing it (RESTRICT, Part D). Archive it instead.",
        ) from e
