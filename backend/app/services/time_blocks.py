"""
Service-layer logic for TimeBlock. The one rule that matters here is the
one Part A/B of the spec is explicit CANNOT be a database CHECK: a
TimeBlock may only be created against a flexible Commitment. This is the
single code path that check has to live in — see app/models/time_block.py
and Part A of the schema spec for why it's deliberately not a trigger.
"""
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.mutation import touch_updated_at
from app.models.commitment import Commitment
from app.models.time_block import TimeBlock
from app.schemas.time_block import TimeBlockComplete, TimeBlockCreate


def create_time_block(db: Session, user_id: str, commitment_id: str, payload: TimeBlockCreate) -> TimeBlock:
    commitment = db.execute(
        select(Commitment).where(Commitment.id == commitment_id, Commitment.user_id == user_id)
    ).scalar_one_or_none()

    if commitment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commitment not found")

    # THE flexible-only check (Part A: "Fixed cannot have TimeBlocks").
    # Deliberately application-enforced, not a DB trigger — see the spec's
    # reasoning: this is always the one place a TimeBlock can be created,
    # and it already has to load the parent Commitment to schedule against.
    if commitment.mode != "flexible":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Commitment {commitment_id} is mode='{commitment.mode}' — "
                   f"TimeBlocks can only be created against flexible Commitments.",
        )

    time_block = TimeBlock(
        commitment_id=commitment_id,
        start_at=payload.start_at,
        end_at=payload.end_at,
    )
    db.add(time_block)
    db.commit()
    db.refresh(time_block)
    return time_block


def list_time_blocks(db: Session, user_id: str, commitment_id: str) -> list[TimeBlock]:
    # Scoped through commitments, per Part L's explicit reclassification:
    # time_blocks has no local user_id, so ownership is only ever checked
    # by joining through its parent Commitment — never assumed.
    stmt = (
        select(TimeBlock)
        .join(Commitment, TimeBlock.commitment_id == Commitment.id)
        .where(Commitment.id == commitment_id, Commitment.user_id == user_id)
        .order_by(TimeBlock.start_at)
    )
    return list(db.execute(stmt).scalars().all())


def _get_owned_time_block(db: Session, user_id: str, commitment_id: str, time_block_id: str) -> TimeBlock:
    stmt = (
        select(TimeBlock)
        .join(Commitment, TimeBlock.commitment_id == Commitment.id)
        .where(TimeBlock.id == time_block_id, Commitment.id == commitment_id, Commitment.user_id == user_id)
    )
    time_block = db.execute(stmt).scalar_one_or_none()
    if time_block is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="TimeBlock not found")
    return time_block


def complete_time_block(db: Session, user_id: str, commitment_id: str, time_block_id: str, payload: TimeBlockComplete) -> TimeBlock:
    time_block = _get_owned_time_block(db, user_id, commitment_id, time_block_id)
    if time_block.status != "planned":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"TimeBlock is '{time_block.status}', not 'planned' — only a planned TimeBlock can be completed.",
        )
    time_block.status = "completed"
    time_block.actual_duration_minutes = payload.actual_duration_minutes
    touch_updated_at(time_block)
    db.commit()
    db.refresh(time_block)
    return time_block


def skip_time_block(db: Session, user_id: str, commitment_id: str, time_block_id: str) -> TimeBlock:
    """
    TimeBlock-level skip: only this one allocation disappears — the parent
    Commitment's RemainingDemand is untouched (Part A's explicit
    distinction from Commitment-level skip). No parent-side write happens
    here at all; that's the point.
    """
    time_block = _get_owned_time_block(db, user_id, commitment_id, time_block_id)
    if time_block.status != "planned":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"TimeBlock is '{time_block.status}', not 'planned' — only a planned TimeBlock can be skipped.",
        )
    time_block.status = "skipped"
    time_block.actual_duration_minutes = None  # chk_tb_actual_consistency requires this
    touch_updated_at(time_block)
    db.commit()
    db.refresh(time_block)
    return time_block


def move_time_block(db: Session, user_id: str, commitment_id: str, time_block_id: str, payload) -> TimeBlock:
    time_block = _get_owned_time_block(db, user_id, commitment_id, time_block_id)
    if time_block.status != "planned":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Only a planned block can be moved.")
    time_block.start_at, time_block.end_at = payload.start_at, payload.end_at
    time_block.reschedule_count = (time_block.reschedule_count or 0) + 1
    touch_updated_at(time_block)
    db.commit()
    db.refresh(time_block)
    return time_block


def delete_time_block(db: Session, user_id: str, commitment_id: str, time_block_id: str) -> None:
    time_block = _get_owned_time_block(db, user_id, commitment_id, time_block_id)
    if time_block.status != "planned":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Only a planned block can be removed.")
    db.delete(time_block)
    db.commit()
