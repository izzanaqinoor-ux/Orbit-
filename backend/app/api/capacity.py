from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_id
from app.db.session import get_db
from app.models.commitment import Commitment
from app.models.user import User
from app.schemas.capacity import CommitmentDemandRead, WeekCapacityRead
from app.services.capacity import compute_commitment_demand, compute_week_capacity

router = APIRouter(tags=["capacity"])


@router.get("/capacity/current", response_model=WeekCapacityRead)
def get_current_week_capacity(user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> WeekCapacityRead:
    user = db.execute(select(User).where(User.id == user_id)).scalar_one()
    return compute_week_capacity(db, user)


@router.get("/demand/open", response_model=list[CommitmentDemandRead])
def get_open_demand(user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> list[CommitmentDemandRead]:
    """Demand metrics for every open (todo/in_progress) flexible Commitment —
    what the dashboard's 'work waiting for time' list needs, regardless of due date."""
    rows = db.execute(
        select(Commitment).where(
            Commitment.user_id == user_id, Commitment.mode == "flexible",
            Commitment.status.in_(("todo", "in_progress")),
        ).order_by(Commitment.due_at.asc().nulls_last(), Commitment.created_at)
    ).scalars().all()
    return [compute_commitment_demand(db, c) for c in rows]


@router.get("/commitments/{commitment_id}/demand", response_model=CommitmentDemandRead)
def get_commitment_demand(
    commitment_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)
) -> CommitmentDemandRead:
    commitment = db.execute(
        select(Commitment).where(Commitment.id == commitment_id, Commitment.user_id == user_id)
    ).scalar_one_or_none()
    if commitment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commitment not found")
    if commitment.mode != "flexible":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Demand metrics (E, A, P_total, RemainingDemand, ...) only apply to flexible Commitments — "
                   "a fixed Commitment directly occupies calendar time and has no separate demand.",
        )
    return compute_commitment_demand(db, commitment)
