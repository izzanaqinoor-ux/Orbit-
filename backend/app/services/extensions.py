"""
Service logic for Assignment/Exam/Shift — the 1:1 domain extensions.

Two application-enforced rules from Part C live here, both deliberately
NOT database triggers (same reasoning as the flexible-only TimeBlock check:
this is always the one place an extension row gets created, and it already
has to load the parent Commitment):

1. Mode/category pairing — Assignment needs a flexible+study parent, Exam
   needs fixed+study, Shift needs fixed+work.
2. Cross-extension-type mutual exclusivity — a Commitment can't have both
   an Assignment and a Shift, etc.

The 1:1-per-type constraint itself (a Commitment can't have TWO Assignment
rows) is already DB-enforced via UNIQUE(commitment_id) — this file doesn't
need to re-check that; it just lets the IntegrityError surface as a clean
409 rather than a raw 500.
"""
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.commitment import Commitment
from app.models.extensions import Assignment, Exam, Shift
from app.schemas.extensions import AssignmentCreate, ExamCreate, ShiftCreate

_EXTENSION_MODELS = (Assignment, Exam, Shift)


def _get_owned_commitment(db: Session, user_id: str, commitment_id: str) -> Commitment:
    commitment = db.execute(
        select(Commitment).where(Commitment.id == commitment_id, Commitment.user_id == user_id)
    ).scalar_one_or_none()
    if commitment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commitment not found")
    return commitment


def _check_mutual_exclusivity(db: Session, commitment_id: str, creating: type) -> None:
    for model in _EXTENSION_MODELS:
        if model is creating:
            continue
        existing = db.execute(select(model.id).where(model.commitment_id == commitment_id)).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"This Commitment already has a {model.__name__} — a Commitment cannot have more than "
                       f"one type of domain extension at once (Part C: cross-extension-type mutual exclusivity).",
            )


def create_assignment(db: Session, user_id: str, commitment_id: str, payload: AssignmentCreate) -> Assignment:
    commitment = _get_owned_commitment(db, user_id, commitment_id)
    if commitment.mode != "flexible" or commitment.category != "study":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"An Assignment requires its Commitment to be mode='flexible' and category='study' "
                   f"(got mode='{commitment.mode}', category='{commitment.category}') — Part C.",
        )
    _check_mutual_exclusivity(db, commitment_id, Assignment)

    assignment = Assignment(user_id=user_id, commitment_id=commitment_id, **payload.model_dump())
    db.add(assignment)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not create Assignment — either one already exists for this Commitment, "
                   "or module_id doesn't belong to you (fk_assignments_module_same_user).",
        ) from e
    db.refresh(assignment)
    return assignment


def create_exam(db: Session, user_id: str, commitment_id: str, payload: ExamCreate) -> Exam:
    commitment = _get_owned_commitment(db, user_id, commitment_id)
    if commitment.mode != "fixed" or commitment.category != "study":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"An Exam requires its Commitment to be mode='fixed' and category='study' "
                   f"(got mode='{commitment.mode}', category='{commitment.category}') — Part C.",
        )
    _check_mutual_exclusivity(db, commitment_id, Exam)

    exam = Exam(user_id=user_id, commitment_id=commitment_id, **payload.model_dump())
    db.add(exam)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not create Exam — either one already exists for this Commitment, "
                   "or module_id doesn't belong to you (fk_exams_module_same_user).",
        ) from e
    db.refresh(exam)
    return exam


def create_shift(db: Session, user_id: str, commitment_id: str, payload: ShiftCreate) -> Shift:
    commitment = _get_owned_commitment(db, user_id, commitment_id)
    if commitment.mode != "fixed" or commitment.category != "work":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"A Shift requires its Commitment to be mode='fixed' and category='work' "
                   f"(got mode='{commitment.mode}', category='{commitment.category}') — Part C.",
        )
    _check_mutual_exclusivity(db, commitment_id, Shift)

    shift = Shift(user_id=user_id, commitment_id=commitment_id, **payload.model_dump())
    db.add(shift)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not create Shift — either one already exists for this Commitment, "
                   "or job_id doesn't belong to you (fk_shifts_job_same_user).",
        ) from e
    db.refresh(shift)
    return shift


def get_assignment(db: Session, user_id: str, commitment_id: str) -> Assignment | None:
    return db.execute(
        select(Assignment).join(Commitment).where(Commitment.id == commitment_id, Commitment.user_id == user_id)
    ).scalar_one_or_none()


def get_exam(db: Session, user_id: str, commitment_id: str) -> Exam | None:
    return db.execute(
        select(Exam).join(Commitment).where(Commitment.id == commitment_id, Commitment.user_id == user_id)
    ).scalar_one_or_none()


def get_shift(db: Session, user_id: str, commitment_id: str) -> Shift | None:
    return db.execute(
        select(Shift).join(Commitment).where(Commitment.id == commitment_id, Commitment.user_id == user_id)
    ).scalar_one_or_none()
