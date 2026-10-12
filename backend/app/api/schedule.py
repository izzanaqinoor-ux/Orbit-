from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_id
from app.db.session import get_db
from app.models.user import User
from app.services import schedule as svc

router = APIRouter(tags=["schedule"])


class PlanetRead(BaseModel):
    id: str
    name: str
    kind: str
    color: str
    model_config = {"from_attributes": True}


class PlanetCreate(BaseModel):
    name: str
    kind: str = "other"
    color: str = "other"


class PlanetUpdate(BaseModel):
    name: str | None = None
    color: str | None = None


@router.get("/planets", response_model=list[PlanetRead])
def list_planets(user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return svc.list_planets(db, user_id)


@router.post("/planets", response_model=PlanetRead, status_code=201)
def create_planet(body: PlanetCreate, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return svc.create_planet(db, user_id, body.name, body.kind, body.color)


@router.patch("/planets/{planet_id}", response_model=PlanetRead)
def update_planet(planet_id: str, body: PlanetUpdate, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    p = svc.get_planet(db, user_id, planet_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Planet not found")
    return svc.update_planet(db, p, body.name, body.color)


@router.delete("/planets/{planet_id}", status_code=204)
def delete_planet(planet_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> None:
    p = svc.get_planet(db, user_id, planet_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Planet not found")
    svc.delete_planet(db, p)


class TermRead(BaseModel):
    id: str
    kind: str
    name: str
    start_date: date
    end_date: date
    model_config = {"from_attributes": True}


class TermCreate(BaseModel):
    kind: str
    name: str = ""
    start_date: date
    end_date: date


class TermsOut(BaseModel):
    terms: list[TermRead]
    current: TermRead | None
    next: TermRead | None
    needs_input: bool
    message: str | None


@router.get("/terms", response_model=TermsOut)
def terms(user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.id == user_id)).scalar_one()
    today = datetime.now(timezone.utc).astimezone(ZoneInfo(user.timezone)).date()
    ts = svc.list_terms(db, user_id)
    st = svc.term_status(ts, today)
    return TermsOut(terms=ts, current=st.current, next=st.next, needs_input=st.needs_input, message=st.message)


@router.post("/terms", response_model=TermRead, status_code=201)
def create_term(body: TermCreate, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return svc.create_term(db, user_id, body.kind, body.name, body.start_date, body.end_date)


@router.delete("/terms/{term_id}", status_code=204)
def delete_term(term_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> None:
    svc.delete_term(db, user_id, term_id)


# ── occasions ──
class OccasionIn(BaseModel):
    title: str
    occurs_on: date
    occurs_time: time | None = None
    repeats_yearly: bool = False
    note: str | None = None


@router.get("/occasions")
def occasions(start: date | None = None, end: date | None = None, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.id == user_id)).scalar_one()
    today = datetime.now(timezone.utc).astimezone(ZoneInfo(user.timezone)).date()
    s0, e0 = start or today, end or (today + timedelta(days=60))
    if e0 < s0 or (e0 - s0).days > 800:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick a sensible date range.")
    return [{**o, "days_away": (o["date"] - today).days} for o in svc.list_occasions(db, user_id, s0, e0)]


@router.post("/occasions", status_code=201)
def create_occasion(body: OccasionIn, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)):
    o = svc.create_occasion(db, user_id, body.title, body.occurs_on, body.occurs_time, body.repeats_yearly, body.note)
    return {"id": o.id}


@router.delete("/occasions/{occasion_id}", status_code=204)
def delete_occasion(occasion_id: str, user_id: str = Depends(get_current_user_id), db: Session = Depends(get_db)) -> None:
    svc.delete_occasion(db, user_id, occasion_id)
