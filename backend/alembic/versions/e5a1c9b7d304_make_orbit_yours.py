"""feature choices, onboarded flag, tester feedback

Revision ID: e5a1c9b7d304
Revises: d4f7b2a9e611
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'e5a1c9b7d304'
down_revision: Union[str, Sequence[str], None] = 'd4f7b2a9e611'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('features', postgresql.JSONB(), server_default='{}', nullable=False))
    op.add_column('users', sa.Column('onboarded', sa.Boolean(), server_default='false', nullable=False))
    op.create_table('feedback',
        sa.Column('id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('user_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('rating', sa.SmallInteger(), nullable=True),
        sa.Column('page', sa.Text(), nullable=False),
        sa.Column('comment', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint('rating IS NULL OR rating BETWEEN 1 AND 5', name='chk_feedback_rating'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_feedback_user', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('feedback')
    op.drop_column('users', 'onboarded')
    op.drop_column('users', 'features')
