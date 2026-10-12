from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_id
from app.db.session import get_db
from app.schemas.extensions import (
    AssignmentCreate, AssignmentRead, ExamCreate, ExamRead, ShiftCreate, ShiftRead,
)
from app.services import extensions as service

router = APIRouter(prefix="/commitments/{commitment_id}", tags=["extensions"])


@router.post("/assignment", response_model=AssignmentRead, status_code=status.HTTP_201_CREATED)
def create_assignment(
    commitment_id: str, payload: AssignmentCreate,
    user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db),
) -> AssignmentRead:
    return service.create_assignment(db, user_id, commitment_id, payload)


@router.get("/assignment", response_model=AssignmentRead)
def get_assignment(commitment_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> AssignmentRead:
    assignment = service.get_assignment(db, user_id, commitment_id)
    if assignment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No Assignment for this Commitment")
    return assignment


@router.post("/exam", response_model=ExamRead, status_code=status.HTTP_201_CREATED)
def create_exam(
    commitment_id: str, payload: ExamCreate,
    user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db),
) -> ExamRead:
    return service.create_exam(db, user_id, commitment_id, payload)


@router.get("/exam", response_model=ExamRead)
def get_exam(commitment_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> ExamRead:
    exam = service.get_exam(db, user_id, commitment_id)
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No Exam for this Commitment")
    return exam


@router.post("/shift", response_model=ShiftRead, status_code=status.HTTP_201_CREATED)
def create_shift(
    commitment_id: str, payload: ShiftCreate,
    user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db),
) -> ShiftRead:
    return service.create_shift(db, user_id, commitment_id, payload)


@router.get("/shift", response_model=ShiftRead)
def get_shift(commitment_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> ShiftRead:
    shift = service.get_shift(db, user_id, commitment_id)
    if shift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No Shift for this Commitment")
    return shift
