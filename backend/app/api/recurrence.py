from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_id
from app.db.session import get_db
from app.models.commitment import Commitment
from app.models.time_block import TimeBlock
from app.models.user import User
from app.schemas.commitment import CommitmentRead
from app.services import recurrence_service as svc

router = APIRouter(tags=["recurrence"])


class ExceptionCreate(BaseModel):
    excluded_date: date


class ExceptionRead(BaseModel):
    id: str
    commitment_id: str
    excluded_date: date
    model_config = {"from_attributes": True}


class CalendarItem(BaseModel):
    kind: str  # "fixed" | "time_block" | "virtual_occurrence"
    commitment_id: str          # the row itself, or the template for virtual items
    title: str
    category: str
    planet_id: str | None = None
    start_at: datetime
    end_at: datetime
    status: str | None = None
    is_virtual: bool = False
    occurrence_date: date | None = None
    time_block_id: str | None = None


def _user(db: Session, user_id: str) -> User:
    return db.execute(select(User).where(User.id == user_id)).scalar_one()


@router.post("/commitments/{template_id}/exceptions", response_model=ExceptionRead, status_code=201)
def add_exception(template_id: str, body: ExceptionCreate, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return svc.add_exception(db, _user(db, user_id), template_id, body.excluded_date)


@router.get("/commitments/{template_id}/exceptions", response_model=list[ExceptionRead])
def list_exceptions(template_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return svc.list_exceptions(db, user_id, template_id)


@router.delete("/commitments/{template_id}/exceptions/{excluded_date}", status_code=204)
def remove_exception(template_id: str, excluded_date: date, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> None:
    svc.remove_exception(db, user_id, template_id, excluded_date)


@router.post("/commitments/{template_id}/occurrences/{occurrence_date}", response_model=CommitmentRead, status_code=201)
def materialize(template_id: str, occurrence_date: date, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return svc.materialize(db, _user(db, user_id), template_id, occurrence_date)


@router.get("/calendar", response_model=list[CalendarItem])
def calendar(
    start: datetime = Query(...),
    end: datetime = Query(...),
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Everything occupying [start, end): real fixed rows, planned/completed
    TimeBlocks, and virtual recurrence occurrences (flagged is_virtual)."""
    if end <= start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "end must be after start")
    if end - start > timedelta(days=62):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Window too large (max 62 days)")
    if start.tzinfo is None or end.tzinfo is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "start/end must include a UTC offset")
    user = _user(db, user_id)
    items: list[CalendarItem] = []

    fixed = db.execute(
        select(Commitment).where(
            Commitment.user_id == user_id, Commitment.mode == "fixed",
            Commitment.recurrence_rule.is_(None), Commitment.status != "archived",
            Commitment.start_at < end, Commitment.end_at > start,
        )
    ).scalars().all()
    for c in fixed:
        items.append(CalendarItem(
            kind="fixed", commitment_id=c.id, title=c.title, category=c.category, planet_id=c.planet_id,
            start_at=c.start_at, end_at=c.end_at, status=c.status, occurrence_date=c.occurrence_date,
        ))

    blocks = db.execute(
        select(TimeBlock, Commitment).join(Commitment, TimeBlock.commitment_id == Commitment.id).where(
            Commitment.user_id == user_id, TimeBlock.status.in_(("planned", "completed")),
            TimeBlock.start_at < end, TimeBlock.end_at > start,
        )
    ).all()
    for tb, c in blocks:
        items.append(CalendarItem(
            kind="time_block", commitment_id=c.id, title=c.title, category=c.category, planet_id=c.planet_id,
            start_at=tb.start_at, end_at=tb.end_at, status=tb.status, time_block_id=tb.id,
        ))

    for v in svc.virtual_occurrences(db, user, start, end):
        items.append(CalendarItem(
            kind="virtual_occurrence", commitment_id=v.template.id, title=v.template.title,
            category=v.template.category, planet_id=v.template.planet_id, start_at=v.occurrence.start_at, end_at=v.occurrence.end_at,
            is_virtual=True, occurrence_date=v.occurrence.occurrence_date,
        ))

    items.sort(key=lambda i: i.start_at)
    return items
