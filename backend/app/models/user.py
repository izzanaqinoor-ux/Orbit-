from datetime import date

from sqlalchemy import BigInteger, Boolean, CheckConstraint, ForeignKeyConstraint, Integer, Numeric, SmallInteger, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.ids import generate_uuid7
from app.db.base import Base, CreatedAtMixin, UpdatedAtMixin


class User(Base, CreatedAtMixin, UpdatedAtMixin):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("email = lower(email)", name="chk_email_lowercase"),
        CheckConstraint("weekly_capacity_minutes >= 0", name="chk_capacity_nonneg"),
        CheckConstraint("valuation_day BETWEEN 1 AND 28", name="chk_valuation_day"),
        CheckConstraint("exam_focus_days BETWEEN 0 AND 30", name="chk_exam_focus_days"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="chk_currency_code"),
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=generate_uuid7)
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    timezone: Mapped[str] = mapped_column(Text, nullable=False, default="Asia/Singapore")
    weekly_capacity_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=2400)
    currency: Mapped[str] = mapped_column(Text, nullable=False, default="SGD")
    birth_date: Mapped[date | None] = mapped_column(nullable=True)  # for age-based milestones
    exam_focus_days: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=7, server_default="7")  # 0 = off
    valuation_day: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1, server_default="1")  # monthly investment check-in

    # "Make Orbit yours": which parts of Orbit this person uses. Hidden, never deleted.
    features: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    onboarded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    goals: Mapped[list["Goal"]] = relationship(back_populates="user")
    modules: Mapped[list["Module"]] = relationship(back_populates="user")
    jobs: Mapped[list["Job"]] = relationship(back_populates="user")
    commitments: Mapped[list["Commitment"]] = relationship(back_populates="user")


class Goal(Base, CreatedAtMixin, UpdatedAtMixin):
    __tablename__ = "goals"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_goals_user"),
        # Supports commitments.goal_id's composite FK (Part L).
        UniqueConstraint("user_id", "id", name="uq_goals_user_id"),
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=generate_uuid7)
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    target_value: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    current_value: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    target_date: Mapped[date | None] = mapped_column(nullable=True)
    # A study plan (a project or an exam broken into pieces) is a goal whose commitments are its pieces.
    kind: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship(back_populates="goals")


class Module(Base, CreatedAtMixin):
    __tablename__ = "modules"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_modules_user"),
        # Supports assignments.module_id / exams.module_id composite FKs (Part L).
        UniqueConstraint("user_id", "id", name="uq_modules_user_id"),
        # uq_module_code — UNIQUE (user_id, code) WHERE code IS NOT NULL — is
        # declared as a partial index in the migration, not here: SQLAlchemy's
        # UniqueConstraint can't express a WHERE clause (Postgres already treats
        # NULL as distinct in a plain UNIQUE constraint, but the spec commits to
        # an explicit partial index, so that's what actually gets created).
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=generate_uuid7)
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    code: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship(back_populates="modules")


class Job(Base, CreatedAtMixin):
    __tablename__ = "jobs"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_jobs_user"),
        # Supports shifts.job_id's composite FK (Part L).
        UniqueConstraint("user_id", "id", name="uq_jobs_user_id"),
        CheckConstraint("hourly_rate IS NULL OR hourly_rate >= 0", name="chk_rate_nonneg"),
        CheckConstraint("pay_basis IN ('hourly', 'monthly')", name="chk_job_pay_basis"),
        CheckConstraint("monthly_pay IS NULL OR monthly_pay >= 0", name="chk_job_monthly_nonneg"),
        CheckConstraint("unpaid_break_minutes >= 0 AND break_after_minutes >= 0", name="chk_job_break_nonneg"),
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=generate_uuid7)
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    hourly_rate: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    # Pay can be per hour or a flat monthly amount (internship stipend, full-time salary).
    pay_basis: Mapped[str] = mapped_column(Text, nullable=False, default="hourly", server_default="hourly")
    monthly_pay: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    # Unpaid break deducted from any shift at least `break_after_minutes` long (configurable, not assumed).
    unpaid_break_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    break_after_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=480, server_default="480")
    # The job whose pay stands for "your hourly rate" across Orbit (What if…, work-hours cost).
    is_main: Mapped[bool] = mapped_column(nullable=False, default=False, server_default="false")

    user: Mapped["User"] = relationship(back_populates="jobs")
