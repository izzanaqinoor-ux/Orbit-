from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_id
from app.db.session import get_db
from app.schemas.commitment import CommitmentCreate, CommitmentRead, CommitmentUpdate
from app.services import commitments as commitment_service

router = APIRouter(prefix="/commitments", tags=["commitments"])


@router.post("", response_model=CommitmentRead, status_code=status.HTTP_201_CREATED)
def create_commitment(
    payload: CommitmentCreate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> CommitmentRead:
    try:
        commitment = commitment_service.create_commitment(db, user_id, payload)
    except IntegrityError as e:
        # Belt-and-suspenders: a DB CHECK/FK caught something the Pydantic
        # schema didn't (e.g. goal_id pointing at a goal that doesn't exist,
        # or belongs to a different user — fk_goal_same_user). This is the
        # "enforce always" half of the validate-early-enforce-always pair.
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e.orig)) from e
    return commitment


@router.get("", response_model=list[CommitmentRead])
def list_commitments(
    status_filter: str | None = None,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> list[CommitmentRead]:
    return commitment_service.list_commitments(db, user_id, status_filter)


@router.get("/{commitment_id}", response_model=CommitmentRead)
def get_commitment(
    commitment_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> CommitmentRead:
    commitment = commitment_service.get_commitment(db, user_id, commitment_id)
    if commitment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commitment not found")
    return commitment


def _get_or_404(db: Session, user_id: str, commitment_id: str):
    commitment = commitment_service.get_commitment(db, user_id, commitment_id)
    if commitment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commitment not found")
    return commitment


@router.patch("/{commitment_id}", response_model=CommitmentRead)
def update_commitment(commitment_id: str, payload: CommitmentUpdate, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> CommitmentRead:
    return commitment_service.update_commitment(db, user_id, _get_or_404(db, user_id, commitment_id), payload)


@router.patch("/{commitment_id}/complete", response_model=CommitmentRead)
def complete_commitment(commitment_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> CommitmentRead:
    return commitment_service.complete_commitment(db, _get_or_404(db, user_id, commitment_id))


@router.patch("/{commitment_id}/skip", response_model=CommitmentRead)
def skip_commitment(commitment_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> CommitmentRead:
    return commitment_service.skip_commitment(db, _get_or_404(db, user_id, commitment_id))


@router.patch("/{commitment_id}/archive", response_model=CommitmentRead)
def archive_commitment(commitment_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> CommitmentRead:
    return commitment_service.archive_commitment(db, _get_or_404(db, user_id, commitment_id))


@router.delete("/{commitment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_commitment(commitment_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> None:
    commitment_service.delete_commitment(db, _get_or_404(db, user_id, commitment_id))
