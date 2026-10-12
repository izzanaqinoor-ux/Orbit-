"""
The declarative base every model inherits from, plus a couple of small
shared mixins (audit timestamps, `updated_at` maintenance) that every table
in the spec uses in the same way — defined once here rather than repeated
across ten model files.
"""
from datetime import datetime, timezone

from sqlalchemy import DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CreatedAtMixin:
    """
    Every table in the spec has `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
    The Python-side default mirrors the DB-side one so a row constructed but
    not yet flushed still has a sane value; the DDL's own `DEFAULT now()`
    remains the source of truth once the row actually hits Postgres.
    """
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )


class UpdatedAtMixin:
    """
    Per Part G-1 of the locked spec: `updated_at` is APPLICATION-maintained,
    not trigger-maintained. `DEFAULT now()` only fires on INSERT — nothing
    at the database layer touches this column again after that.

    This mixin does not silently "fix" that by re-stamping on every commit;
    doing so implicitly here would just be a trigger wearing a Python
    costume, the exact thing the spec deliberately avoided. Instead,
    `app/db/mutation.py` provides the one shared helper
    (`touch_updated_at`) that every service-layer write path is expected to
    call explicitly — see that module's docstring for why it's a function
    to call, not an event listener that fires automatically.
    """
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
