from sqlalchemy import Boolean, CheckConstraint, ForeignKeyConstraint, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.ids import generate_uuid7
from app.db.base import Base, CreatedAtMixin


class Note(Base, CreatedAtMixin):
    """A thought jotted down as it comes. kind='note' is private; kind='feedback' is about Orbit itself and visible to its maker."""
    __tablename__ = "notes"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_notes_user", ondelete="CASCADE"),
        CheckConstraint("kind IN ('note','feedback')", name="chk_note_kind"),
    )
    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=generate_uuid7)
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False, default="note", server_default="note")
    text: Mapped[str] = mapped_column(Text, nullable=False)
    page: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    done: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
