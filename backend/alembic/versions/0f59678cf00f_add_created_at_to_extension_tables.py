"""add created_at to extension tables

The locked spec left assignments/exams/shifts without any audit timestamp,
unlike every other table (users, goals, commitments, time_blocks have
created_at+updated_at; modules/jobs/commitment_exceptions have created_at).
Flagged as a likely oversight rather than silently patched during the
initial migration; decided (2026-09-25): bring these three tables in line
with modules/jobs — created_at only, no updated_at, since these rows are
edited far less independently than a Commitment or TimeBlock is.

`server_default=now()` backfills existing rows sensibly (their creation
time is unknowable retroactively, so "now" is the least-wrong value) and
becomes the ordinary default for every future insert.

Revision ID: 0f59678cf00f
Revises: 8bc7c9fc71b4
Create Date: 2026-09-25
"""
from alembic import op
import sqlalchemy as sa

revision = "0f59678cf00f"
down_revision = "8bc7c9fc71b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("assignments", "exams", "shifts"):
        op.add_column(
            table,
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )


def downgrade() -> None:
    for table in ("assignments", "exams", "shifts"):
        op.drop_column(table, "created_at")
