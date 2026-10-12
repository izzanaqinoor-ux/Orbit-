"""
App factory. Deliberately thin at this stage: the point of this file right
now is to prove the stack boots and can talk to the migrated database —
routers for Commitments/TimeBlocks/etc. are the next milestone, not this one.
"""
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.auth import router as auth_router
from app.api.capacity import router as capacity_router
from app.api.commitments import router as commitments_router
from app.api.extensions import router as extensions_router
from app.api.fin import router as finance_router
from app.api.prefs import router as prefs_router
from app.api.extras import router as extras_router
from app.api.schedule import router as schedule_router
from app.api.goals import router as goals_router
from app.api.jobs import router as jobs_router
from app.api.modules import router as modules_router
from app.api.recurrence import router as recurrence_router
from app.api.time_blocks import router as time_blocks_router
from app.core.config import settings
from app.db.session import get_db

app = FastAPI(title="Orbit API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(commitments_router)
app.include_router(time_blocks_router)
app.include_router(extensions_router)
app.include_router(goals_router)
app.include_router(modules_router)
app.include_router(jobs_router)
app.include_router(capacity_router)
app.include_router(recurrence_router)
app.include_router(finance_router)
app.include_router(schedule_router)
app.include_router(extras_router)
app.include_router(prefs_router)


@app.get("/health")
def health() -> dict:
    """Liveness check — no DB dependency, just confirms the process is up."""
    return {"status": "ok"}


@app.get("/health/db")
def health_db(db: Session = Depends(get_db)) -> dict:
    """
    Readiness check — confirms the app can actually reach Postgres and see
    the migrated schema, not just that the process started.
    """
    row = db.execute(
        text("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
    ).scalar_one()
    return {"status": "ok", "public_tables": row}
