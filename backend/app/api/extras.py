from datetime import date

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_id
from app.db.session import get_db
from app.services import extras as svc

router = APIRouter(tags=["extras"])


@router.get("/exam-focus")
def exam_focus(uid: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return svc.exam_focus(db, uid)


@router.get("/review")
def review(week: date | None = None, uid: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return svc.review(db, uid, week)


@router.get("/export/json")
def export_json(uid: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return Response(content=__import__("json").dumps(svc.export_json(db, uid), indent=1), media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="orbit-export.json"'})


@router.get("/export/entries.csv")
def export_csv(uid: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return Response(content=svc.entries_csv(db, uid), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="orbit-entries.csv"'})
