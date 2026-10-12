"""
The three 1:1 domain extensions (Assignment, Exam, Shift) and
commitment_exceptions.

Note on `user_id` in Assignment/Exam/Shift: this is a deliberately
denormalized column, populated from the parent Commitment at creation time,
that exists solely so the composite same-user FKs (Part L) have a local
column to build the composite key from. It is not an independent fact —
`fk_commitment_same_user` guarantees it always matches the parent
Commitment's own `user_id`.

Note on `created_at`: the locked spec originally left these three tables
without any audit timestamp at all. Flagged rather than silently patched
during initial implementation; decided (2026-09-25) to add `created_at`
only, matching `modules`/`jobs` — no `updated_at`, since these rows are
edited far less independently of their parent Commitment than a Commitment
or TimeBlock is. See migration `0f59678cf00f`.
"""
from datetime import date

from sqlalchemy import CheckConstraint, Date, ForeignKeyConstraint, Numeric, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.ids import generate_uuid7
from app.db.base import Base, CreatedAtMixin


class Assignment(Base, CreatedAtMixin):
    __tablename__ = "assignments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id", "commitment_id"], ["commitments.user_id", "commitments.id"],
            name="fk_assignments_commitment_same_user", ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["user_id", "module_id"], ["modules.user_id", "modules.id"],
            name="fk_assignments_module_same_user", ondelete="RESTRICT",
        ),
        UniqueConstraint("commitment_id", name="uq_assignments_commitment"),
        CheckConstraint(
            "weightage_percent IS NULL OR (weightage_percent >= 0 AND weightage_percent <= 100)",
            name="chk_assignments_weightage_range",
        ),
        CheckConstraint(
            "grade IS NULL OR (grade >= 0 AND grade <= 100)",
            name="chk_assignments_grade_range",
        ),
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=generate_uuid7)
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    commitment_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    module_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    weightage_percent: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    grade: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)

    commitment: Mapped["Commitment"] = relationship(back_populates="assignment")


class Exam(Base, CreatedAtMixin):
    __tablename__ = "exams"
    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id", "commitment_id"], ["commitments.user_id", "commitments.id"],
            name="fk_exams_commitment_same_user", ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["user_id", "module_id"], ["modules.user_id", "modules.id"],
            name="fk_exams_module_same_user", ondelete="RESTRICT",
        ),
        UniqueConstraint("commitment_id", name="uq_exams_commitment"),
        CheckConstraint(
            "weightage_percent IS NULL OR (weightage_percent >= 0 AND weightage_percent <= 100)",
            name="chk_exams_weightage_range",
        ),
        CheckConstraint(
            "grade IS NULL OR (grade >= 0 AND grade <= 100)",
            name="chk_exams_grade_range",
        ),
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=generate_uuid7)
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    commitment_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    module_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    weightage_percent: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    grade: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)

    commitment: Mapped["Commitment"] = relationship(back_populates="exam")


class Shift(Base, CreatedAtMixin):
    __tablename__ = "shifts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id", "commitment_id"], ["commitments.user_id", "commitments.id"],
            name="fk_shifts_commitment_same_user", ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["user_id", "job_id"], ["jobs.user_id", "jobs.id"],
            name="fk_shifts_job_same_user", ondelete="RESTRICT",
        ),
        UniqueConstraint("commitment_id", name="uq_shifts_commitment"),
        CheckConstraint(
            "hourly_rate_override IS NULL OR hourly_rate_override >= 0",
            name="chk_shifts_rate_override_nonneg",
        ),
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=generate_uuid7)
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    commitment_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    job_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    hourly_rate_override: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)

    commitment: Mapped["Commitment"] = relationship(back_populates="shift")


class CommitmentException(Base, CreatedAtMixin):
    """
    Cancels one occurrence date of a recurring template. Must reference a
    template row, not an occurrence — application-enforced, not a CHECK
    (that requires inspecting a different row's shape, which CHECK can't do).
    """
    __tablename__ = "commitment_exceptions"
    __table_args__ = (
        ForeignKeyConstraint(["commitment_id"], ["commitments.id"], name="fk_exceptions_commitment", ondelete="CASCADE"),
        UniqueConstraint("commitment_id", "excluded_date", name="uq_exception"),
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=generate_uuid7)
    commitment_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    excluded_date: Mapped[date] = mapped_column(Date, nullable=False)

    commitment: Mapped["Commitment"] = relationship(back_populates="exceptions")
