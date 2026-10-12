"""study plans on goals, main job flag

Revision ID: a7c3e9d5f216
Revises: f6b2d8c4e105
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a7c3e9d5f216'
down_revision: Union[str, Sequence[str], None] = 'f6b2d8c4e105'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('goals', sa.Column('kind', sa.Text(), nullable=True))
    op.add_column('goals', sa.Column('source_name', sa.Text(), nullable=True))
    op.create_check_constraint('chk_goal_kind', 'goals', "kind IS NULL OR kind IN ('assignment','exam')")
    op.add_column('jobs', sa.Column('is_main', sa.Boolean(), server_default='false', nullable=False))
    # an existing user's first job becomes their main job
    op.execute("""UPDATE jobs SET is_main = true WHERE id IN (
                    SELECT DISTINCT ON (user_id) id FROM jobs ORDER BY user_id, created_at, id)""")


def downgrade() -> None:
    op.drop_column('jobs', 'is_main')
    op.drop_constraint('chk_goal_kind', 'goals', type_='check')
    op.drop_column('goals', 'source_name')
    op.drop_column('goals', 'kind')
