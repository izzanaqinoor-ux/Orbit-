"""
Service logic for Goal, Module, Job. All three share the same shape:
create, list-by-user, get-by-id-scoped-to-user, delete-with-RESTRICT-caught-
as-a-clean-error. Goal additionally supports update, since target_value/
current_value are meant to be revised over time; Module/Job are simpler
reference data that's normally just created once and later deleted.
"""
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.user import Goal, Job, Module
from app.schemas.simple_resources import GoalCreate, GoalUpdate, JobCreate, ModuleCreate

# --- Goals ---------------------------------------------------------------

def create_goal(db: Session, user_id: str, payload: GoalCreate) -> Goal:
    goal = Goal(user_id=user_id, **payload.model_dump())
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


def list_goals(db: Session, user_id: str) -> list[Goal]:
    return list(db.execute(select(Goal).where(Goal.user_id == user_id).order_by(Goal.created_at.desc())).scalars().all())


def get_goal(db: Session, user_id: str, goal_id: str) -> Goal | None:
    return db.execute(select(Goal).where(Goal.id == goal_id, Goal.user_id == user_id)).scalar_one_or_none()


def update_goal(db: Session, goal: Goal, payload: GoalUpdate) -> Goal:
    from app.db.mutation import touch_updated_at

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)
    touch_updated_at(goal)
    db.commit()
    db.refresh(goal)
    return goal


def delete_goal(db: Session, goal: Goal) -> None:
    # Goals have no RESTRICT dependents (commitments.goal_id is SET NULL on
    # delete), so this can never fail with a foreign-key violation — no
    # try/except needed, unlike Module/Job below.
    db.delete(goal)
    db.commit()


# --- Modules ---------------------------------------------------------------

def create_module(db: Session, user_id: str, payload: ModuleCreate) -> Module:
    module = Module(user_id=user_id, **payload.model_dump())
    db.add(module)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A module with this code already exists for your account",
        ) from e
    db.refresh(module)
    return module


def list_modules(db: Session, user_id: str) -> list[Module]:
    return list(db.execute(select(Module).where(Module.user_id == user_id).order_by(Module.name)).scalars().all())


def get_module(db: Session, user_id: str, module_id: str) -> Module | None:
    return db.execute(select(Module).where(Module.id == module_id, Module.user_id == user_id)).scalar_one_or_none()


def delete_module(db: Session, module: Module) -> None:
    db.delete(module)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This module is referenced by an Assignment or Exam and cannot be deleted (Part E: RESTRICT)",
        ) from e


# --- Jobs ---------------------------------------------------------------

def create_job(db: Session, user_id: str, payload: JobCreate) -> Job:
    first = db.execute(select(Job.id).where(Job.user_id == user_id)).first() is None
    job = Job(user_id=user_id, is_main=first, **payload.model_dump())   # the first job is the main one until you say otherwise
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def list_jobs(db: Session, user_id: str) -> list[Job]:
    return list(db.execute(select(Job).where(Job.user_id == user_id).order_by(Job.name)).scalars().all())


def get_job(db: Session, user_id: str, job_id: str) -> Job | None:
    return db.execute(select(Job).where(Job.id == job_id, Job.user_id == user_id)).scalar_one_or_none()


def set_main_job(db: Session, user_id: str, job: Job) -> Job:
    for j in db.execute(select(Job).where(Job.user_id == user_id)).scalars():
        j.is_main = j.id == job.id
    db.commit()
    db.refresh(job)
    return job


def delete_job(db: Session, job: Job) -> None:
    db.delete(job)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This job is referenced by a Shift and cannot be deleted (Part E: RESTRICT)",
        ) from e
