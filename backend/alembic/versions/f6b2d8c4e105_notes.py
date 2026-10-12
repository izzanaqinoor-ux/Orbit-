"""notes (replaces feedback), drop the seeded 'earlier framework' rule set

Revision ID: f6b2d8c4e105
Revises: e5a1c9b7d304
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f6b2d8c4e105'
down_revision: Union[str, Sequence[str], None] = 'e5a1c9b7d304'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('notes',
        sa.Column('id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('user_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('kind', sa.Text(), server_default='note', nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('page', sa.Text(), server_default='', nullable=False),
        sa.Column('done', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('note','feedback')", name='chk_note_kind'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_notes_user', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    # keep anything already sent through the old feedback button
    op.execute("""INSERT INTO notes (id, user_id, kind, text, page, done, created_at)
                  SELECT id, user_id, 'feedback',
                         CASE WHEN rating IS NULL THEN comment ELSE '[' || rating || '/5] ' || comment END,
                         page, false, created_at FROM feedback WHERE comment <> '' OR rating IS NOT NULL""")
    op.drop_table('feedback')
    op.execute("DELETE FROM fin_rule_sets WHERE status = 'historical' AND name = 'Earlier four-asset framework'")


def downgrade() -> None:
    op.create_table('feedback',
        sa.Column('id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('user_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('rating', sa.SmallInteger(), nullable=True),
        sa.Column('page', sa.Text(), nullable=False),
        sa.Column('comment', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_feedback_user', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.drop_table('notes')
