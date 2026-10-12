from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.ids import generate_uuid7
from app.db.base import Base, CreatedAtMixin, UpdatedAtMixin
from app.models.enums import time_block_status_enum


class TimeBlock(Base, CreatedAtMixin, UpdatedAtMixin):
    """
    An allocation of calendar time against a flexible Commitment. The
    flexible-only restriction (Part B: "every TimeBlock belongs to a
    flexible Commitment") is application-enforced, not a DB constraint —
    see Part A/B of the spec for why (the enforcement point is always
    application-mediated, so a trigger would just duplicate a check the
    service layer already has to perform).
    """
    __tablename__ = "time_blocks"
    __table_args__ = (
        ForeignKeyConstraint(["commitment_id"], ["commitments.id"], name="fk_time_blocks_commitment", ondelete="CASCADE"),
        CheckConstraint("end_at > start_at", name="chk_tb_span_valid"),
        CheckConstraint(
            """
            (status = 'completed' AND actual_duration_minutes IS NOT NULL)
            OR
            (status IN ('planned', 'skipped') AND actual_duration_minutes IS NULL)
            """,
            name="chk_tb_actual_consistency",
        ),
        CheckConstraint(
            "actual_duration_minutes IS NULL OR actual_duration_minutes >= 0",
            name="chk_tb_actual_nonneg",
        ),
        CheckConstraint("reschedule_count >= 0", name="chk_reschedule_nonneg"),
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=generate_uuid7)
    commitment_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    start_at: Mapped[datetime] = mapped_column(nullable=False)
    end_at: Mapped[datetime] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(time_block_status_enum, nullable=False, default="planned")
    actual_duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)  # only on completion, feeds A(c)
    reschedule_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    commitment: Mapped["Commitment"] = relationship(back_populates="time_blocks")
