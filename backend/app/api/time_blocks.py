from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_id
from app.db.session import get_db
from app.schemas.time_block import TimeBlockComplete, TimeBlockCreate, TimeBlockMove, TimeBlockRead
from app.services import time_blocks as time_block_service

router = APIRouter(prefix="/commitments/{commitment_id}/time_blocks", tags=["time_blocks"])


@router.post("", response_model=TimeBlockRead, status_code=status.HTTP_201_CREATED)
def create_time_block(
    commitment_id: str,
    payload: TimeBlockCreate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> TimeBlockRead:
    return time_block_service.create_time_block(db, user_id, commitment_id, payload)


@router.get("", response_model=list[TimeBlockRead])
def list_time_blocks(
    commitment_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> list[TimeBlockRead]:
    return time_block_service.list_time_blocks(db, user_id, commitment_id)


@router.patch("/{time_block_id}", response_model=TimeBlockRead)
def move_time_block(
    commitment_id: str, time_block_id: str, payload: TimeBlockMove,
    user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db),
) -> TimeBlockRead:
    return time_block_service.move_time_block(db, user_id, commitment_id, time_block_id, payload)


@router.delete("/{time_block_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_time_block(
    commitment_id: str, time_block_id: str,
    user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db),
) -> None:
    time_block_service.delete_time_block(db, user_id, commitment_id, time_block_id)


@router.patch("/{time_block_id}/complete", response_model=TimeBlockRead)
def complete_time_block(
    commitment_id: str,
    time_block_id: str,
    payload: TimeBlockComplete,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> TimeBlockRead:
    return time_block_service.complete_time_block(db, user_id, commitment_id, time_block_id, payload)


@router.patch("/{time_block_id}/skip", response_model=TimeBlockRead)
def skip_time_block(
    commitment_id: str,
    time_block_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> TimeBlockRead:
    return time_block_service.skip_time_block(db, user_id, commitment_id, time_block_id)
