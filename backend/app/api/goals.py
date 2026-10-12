from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_id
from app.db.session import get_db
from app.schemas.simple_resources import GoalCreate, GoalRead, GoalUpdate
from app.services import simple_resources as service

router = APIRouter(prefix="/goals", tags=["goals"])


@router.post("", response_model=GoalRead, status_code=status.HTTP_201_CREATED)
def create_goal(payload: GoalCreate, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> GoalRead:
    return service.create_goal(db, user_id, payload)


@router.get("", response_model=list[GoalRead])
def list_goals(user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> list[GoalRead]:
    return service.list_goals(db, user_id)


@router.get("/{goal_id}", response_model=GoalRead)
def get_goal(goal_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> GoalRead:
    goal = service.get_goal(db, user_id, goal_id)
    if goal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
    return goal


@router.patch("/{goal_id}", response_model=GoalRead)
def update_goal(
    goal_id: str, payload: GoalUpdate, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)
) -> GoalRead:
    goal = service.get_goal(db, user_id, goal_id)
    if goal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
    return service.update_goal(db, goal, payload)


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(goal_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> None:
    goal = service.get_goal(db, user_id, goal_id)
    if goal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
    service.delete_goal(db, goal)
