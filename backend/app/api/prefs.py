import csv
import io
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_id
from app.core.config import settings
from app.db.session import get_db
from app.models.note import Note
from app.models.user import User

router = APIRouter(tags=["prefs"])

# Every part of Orbit a person can switch off. Turning one off hides it; nothing is deleted.
FEATURES = ("study", "work", "finance", "investing", "planning", "import", "occasions", "review")


def _view(u: User) -> dict:
    return {"features": {k: bool(u.features.get(k, True)) for k in FEATURES}, "onboarded": u.onboarded}


class PrefsIn(BaseModel):
    features: dict[str, bool] | None = None
    onboarded: bool | None = None


@router.get("/preferences")
def get_prefs(uid: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return _view(db.execute(select(User).where(User.id == uid)).scalar_one())


@router.put("/preferences")
def put_prefs(body: PrefsIn, uid: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    u = db.execute(select(User).where(User.id == uid)).scalar_one()
    if body.features is not None:
        bad = set(body.features) - set(FEATURES)
        if bad:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown feature: {sorted(bad)[0]}")
        u.features = {k: bool(body.features.get(k, u.features.get(k, True))) for k in FEATURES}
    if body.onboarded is not None:
        u.onboarded = body.onboarded
    db.commit()
    return _view(u)


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    kind: Literal["note", "feedback"] = "note"
    page: str = Field(default="", max_length=120)


class NotePatch(BaseModel):
    done: bool | None = None
    text: str | None = Field(default=None, min_length=1, max_length=4000)


def _note(n: Note) -> dict:
    return {"id": n.id, "kind": n.kind, "text": n.text, "page": n.page, "done": n.done, "created_at": n.created_at}


def _own(db: Session, uid: str, nid: str) -> Note:
    n = db.execute(select(Note).where(Note.id == nid, Note.user_id == uid)).scalar_one_or_none()
    if n is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    return n


@router.get("/notes")
def list_notes(uid: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    rows = db.execute(select(Note).where(Note.user_id == uid).order_by(Note.done, Note.created_at.desc())).scalars().all()
    return [_note(n) for n in rows]


@router.post("/notes", status_code=201)
def add_note(body: NoteIn, uid: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    if not body.text.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Write something first.")
    n = Note(user_id=uid, kind=body.kind, text=body.text.strip(), page=body.page)
    db.add(n)
    db.commit()
    return _note(n)


@router.patch("/notes/{nid}")
def patch_note(nid: str, body: NotePatch, uid: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    n = _own(db, uid, nid)
    if body.done is not None:
        n.done = body.done
    if body.text is not None and body.text.strip():
        n.text = body.text.strip()
    db.commit()
    return _note(n)


@router.delete("/notes/{nid}", status_code=204)
def delete_note(nid: str, uid: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> None:
    db.delete(_own(db, uid, nid))
    db.commit()


@router.get("/admin/feedback.csv")
def feedback_csv(uid: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    me = db.execute(select(User).where(User.id == uid)).scalar_one()
    if not settings.admin_email or me.email != settings.admin_email.strip().lower():
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not available.")
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["when", "who", "page", "note", "done", "features_on"])
    rows = db.execute(select(Note, User).join(User, User.id == Note.user_id).where(Note.kind == "feedback").order_by(Note.created_at)).all()
    for n, u in rows:
        w.writerow([n.created_at.isoformat(), u.email, n.page, n.text, "yes" if n.done else "", " ".join(k for k in FEATURES if u.features.get(k, True))])
    return Response(content=out.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="orbit-feedback.csv"'})
