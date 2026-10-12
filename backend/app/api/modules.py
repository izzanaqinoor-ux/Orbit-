from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_id
from app.db.session import get_db
from app.schemas.simple_resources import ModuleCreate, ModuleRead
from app.services import simple_resources as service

router = APIRouter(prefix="/modules", tags=["modules"])


@router.post("", response_model=ModuleRead, status_code=status.HTTP_201_CREATED)
def create_module(payload: ModuleCreate, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> ModuleRead:
    return service.create_module(db, user_id, payload)


@router.get("", response_model=list[ModuleRead])
def list_modules(user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> list[ModuleRead]:
    return service.list_modules(db, user_id)


@router.get("/{module_id}", response_model=ModuleRead)
def get_module(module_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> ModuleRead:
    module = service.get_module(db, user_id, module_id)
    if module is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Module not found")
    return module


@router.delete("/{module_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_module(module_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> None:
    module = service.get_module(db, user_id, module_id)
    if module is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Module not found")
    service.delete_module(db, module)
