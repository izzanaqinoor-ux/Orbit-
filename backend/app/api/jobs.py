from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_id
from app.db.session import get_db
from app.schemas.simple_resources import JobCreate, JobRead
from app.services import simple_resources as service

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.post("", response_model=JobRead, status_code=status.HTTP_201_CREATED)
def create_job(payload: JobCreate, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> JobRead:
    return service.create_job(db, user_id, payload)


@router.get("", response_model=list[JobRead])
def list_jobs(user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> list[JobRead]:
    return service.list_jobs(db, user_id)


@router.get("/{job_id}", response_model=JobRead)
def get_job(job_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> JobRead:
    job = service.get_job(db, user_id, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return job


@router.patch("/{job_id}/main", response_model=JobRead)
def make_main_job(job_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> JobRead:
    job = service.get_job(db, user_id, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return service.set_main_job(db, user_id, job)


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job(job_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> None:
    job = service.get_job(db, user_id, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    service.delete_job(db, job)
