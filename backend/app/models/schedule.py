"""User-defined planets (categories) and school terms/breaks."""
from datetime import date, time

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKeyConstraint, Text, Time, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.ids import generate_uuid7
from app.db.base import Base, CreatedAtMixin

PLANET_KINDS = ("study", "work", "personal", "other")
PLANET_COLORS = ("study", "work", "personal", "other", "finance", "rose", "sand", "violet")


class Planet(Base, CreatedAtMixin):
    """
    A category the user created. `kind` is the behavioural family (an Exam needs a
    study-kind planet, a Shift a work-kind planet); name/colour are free.
    """
    __tablename__ = "planets"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_planets_user"),
        UniqueConstraint("user_id", "id", name="uq_planets_user_id"),
        UniqueConstraint("user_id", "name", name="uq_planet_name"),
        CheckConstraint("kind IN ('study','work','personal','other')", name="chk_planet_kind"),
        CheckConstraint("length(trim(name)) > 0", name="chk_planet_name"),
    )
    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=generate_uuid7)
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False, default="other")
    color: Mapped[str] = mapped_column(Text, nullable=False, default="other")


class SchoolTerm(Base, CreatedAtMixin):
    __tablename__ = "school_terms"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_terms_user"),
        CheckConstraint("kind IN ('term','break')", name="chk_term_kind"),
        CheckConstraint("end_date >= start_date", name="chk_term_span"),
    )
    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=generate_uuid7)
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)


class Occasion(Base, CreatedAtMixin):
    """Things that rarely happen: a birthday, a dinner, a trip day. Optionally repeats every year."""
    __tablename__ = "occasions"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_occasions_user", ondelete="CASCADE"),
        CheckConstraint("length(trim(title)) > 0", name="chk_occasion_title"),
    )
    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=generate_uuid7)
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    occurs_on: Mapped[date] = mapped_column(Date, nullable=False)
    occurs_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    repeats_yearly: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
