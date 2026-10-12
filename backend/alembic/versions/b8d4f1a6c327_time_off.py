"""time off flag on commitments

Revision ID: b8d4f1a6c327
Revises: a7c3e9d5f216
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b8d4f1a6c327'
down_revision: Union[str, Sequence[str], None] = 'a7c3e9d5f216'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('commitments', sa.Column('time_off', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_column('commitments', 'time_off')
