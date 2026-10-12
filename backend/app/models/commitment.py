from datetime import date, datetime

from sqlalchemy import Boolean, CheckConstraint, ForeignKeyConstraint, Integer, SmallInteger, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.ids import generate_uuid7
from app.db.base import Base, CreatedAtMixin, UpdatedAtMixin
from app.models.enums import commitment_category_enum, commitment_mode_enum, commitment_status_enum


class Commitment(Base, CreatedAtMixin, UpdatedAtMixin):
    __tablename__ = "commitments"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_commitments_user"),
        # Same-user composite FKs (Part L).
        ForeignKeyConstraint(
            ["user_id", "goal_id"], ["goals.user_id", "goals.id"],
            name="fk_goal_same_user",
            # NOTE: the DDL for this FK uses the PostgreSQL 15+ column-specific
            # form `ON DELETE SET NULL (goal_id)`, not plain SET NULL — plain
            # SET NULL on a composite FK would attempt to null user_id too,
            # which is NOT NULL. SQLAlchemy's ForeignKeyConstraint can't express
            # the column-specific form, so this constraint's *real* DDL is
            # hand-written in the migration; this declaration exists for
            # ORM/documentation parity and is not what actually gets executed.
        ),
        ForeignKeyConstraint(
            ["user_id", "recurrence_template_id"], ["commitments.user_id", "commitments.id"],
            name="fk_template_same_user", ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["user_id", "planet_id"], ["planets.user_id", "planets.id"],
            name="fk_planet_same_user",
            # Real DDL (migration): ON DELETE SET NULL (planet_id), PG15+ — see fk_goal_same_user note above.
        ),
        CheckConstraint("due_all_day = false OR due_at IS NOT NULL", name="chk_all_day_needs_due"),
        UniqueConstraint("user_id", "id", name="uq_commitments_user_id"),
        UniqueConstraint("recurrence_template_id", "occurrence_date", name="uq_template_occurrence"),

        # --- Part A: fixed/flexible field-requirement pairing ---
        CheckConstraint(
            """
            (mode = 'fixed'    AND start_at IS NOT NULL AND end_at IS NOT NULL
                               AND due_at IS NULL AND estimated_duration_minutes IS NULL)
            OR
            (mode = 'flexible' AND estimated_duration_minutes IS NOT NULL
                               AND start_at IS NULL AND end_at IS NULL)
            """,
            name="chk_mode_fields",
        ),
        CheckConstraint("end_at IS NULL OR start_at IS NULL OR end_at > start_at", name="chk_span_valid"),
        CheckConstraint(
            "estimated_duration_minutes IS NULL OR estimated_duration_minutes >= 0",
            name="chk_estimate_nonneg",
        ),

        # --- Part A: completed_at / status consistency ---
        CheckConstraint(
            """
            (status = 'completed' AND completed_at IS NOT NULL)
            OR
            (status IN ('todo', 'in_progress', 'skipped') AND completed_at IS NULL)
            OR
            (status = 'archived')
            """,
            name="chk_completed_at_consistency",
        ),

        # --- Part A: recurrence template status restriction ---
        CheckConstraint(
            "recurrence_rule IS NULL OR status IN ('todo', 'in_progress', 'archived')",
            name="chk_template_status",
        ),

        # --- Part A / D (correction pass 5, blocker fix): templates must be fixed-mode ---
        CheckConstraint(
            "recurrence_rule IS NULL OR mode = 'fixed'",
            name="chk_recurrence_fixed_template",
        ),

        # --- Part D: three-way exclusive recurrence role ---
        CheckConstraint(
            """
            (recurrence_rule IS NULL AND recurrence_template_id IS NULL
             AND occurrence_date IS NULL AND recurrence_end_date IS NULL)
            OR
            (recurrence_rule IS NOT NULL AND recurrence_template_id IS NULL
             AND occurrence_date IS NULL)
            OR
            (recurrence_rule IS NULL AND recurrence_template_id IS NOT NULL
             AND occurrence_date IS NOT NULL AND recurrence_end_date IS NULL)
            """,
            name="chk_recurrence_role",
        ),
        CheckConstraint(
            "recurrence_template_id IS NULL OR recurrence_template_id != id",
            name="chk_no_self_template",
        ),
        # chk_no_due_on_recurring_flexible is intentionally NOT declared here —
        # retired in correction pass 5, superseded by chk_recurrence_fixed_template.
        # See Part D of the schema spec for the full explanation.
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=generate_uuid7)
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    mode: Mapped[str] = mapped_column(commitment_mode_enum, nullable=False)
    status: Mapped[str] = mapped_column(commitment_status_enum, nullable=False, default="todo")
    category: Mapped[str] = mapped_column(commitment_category_enum, nullable=False, default="other")
    priority: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=3)  # 1 = highest, 5 = lowest

    start_at: Mapped[datetime | None] = mapped_column(nullable=True)   # fixed-mode only
    end_at: Mapped[datetime | None] = mapped_column(nullable=True)     # fixed-mode only
    due_at: Mapped[datetime | None] = mapped_column(nullable=True)     # flexible-mode only, optional
    # True = the user only gave a day ("laundry by Friday"); due_at is then the end of that local day.
    due_all_day: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # User-defined planet. `category` stays as the planet's *kind* (drives Exam/Shift/Assignment rules).
    planet_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    estimated_duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)  # flexible-mode only, E(c)

    # none_as_null=True is load-bearing, not stylistic: SQLAlchemy's JSONB
    # type defaults to serializing Python None as the JSON null literal
    # ('null'::jsonb) rather than a real SQL NULL. Without this flag, every
    # non-recurring Commitment created with an explicit
    # `recurrence_rule=None` would store a JSON-null value that passes
    # `IS NOT NULL` in Postgres — silently satisfying chk_recurrence_role's
    # TEMPLATE branch instead of its NORMAL branch, misclassifying an
    # ordinary Commitment as a recurrence template with no CHECK ever
    # failing to catch it. Discovered via the capacity math verification,
    # not by inspection — a reminder that "the CHECK passed" and "the data
    # means what you think it means" are different claims.
    recurrence_rule: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True), nullable=True)   # template rows only
    recurrence_end_date: Mapped[date | None] = mapped_column(nullable=True)      # template rows only
    recurrence_template_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)  # occurrence rows only
    occurrence_date: Mapped[date | None] = mapped_column(nullable=True)          # occurrence rows only

    goal_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    # A day (or run of days) off: shown as a banner across the calendar and planned around.
    time_off: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)

    user: Mapped["User"] = relationship(back_populates="commitments", foreign_keys=[user_id])
    goal: Mapped["Goal | None"] = relationship(foreign_keys=[goal_id])
    time_blocks: Mapped[list["TimeBlock"]] = relationship(back_populates="commitment", cascade="all, delete-orphan")
    assignment: Mapped["Assignment | None"] = relationship(back_populates="commitment", uselist=False)
    exam: Mapped["Exam | None"] = relationship(back_populates="commitment", uselist=False)
    shift: Mapped["Shift | None"] = relationship(back_populates="commitment", uselist=False)
    exceptions: Mapped[list["CommitmentException"]] = relationship(back_populates="commitment", cascade="all, delete-orphan")
