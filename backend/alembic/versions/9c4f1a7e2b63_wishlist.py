"""wishlist; remove default purification category

Revision ID: 9c4f1a7e2b63
Revises: 7a9c3e5d1b20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '9c4f1a7e2b63'
down_revision: Union[str, Sequence[str], None] = '7a9c3e5d1b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('fin_wishlist',
        sa.Column('id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('user_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('price_cents', sa.BigInteger(), nullable=False),
        sa.Column('category_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('archived', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint('price_cents > 0', name='chk_wish_price'),
        sa.ForeignKeyConstraint(['user_id', 'category_id'], ['fin_categories.user_id', 'fin_categories.id'], name='fk_wish_category_same_user', ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_fin_wishlist_user', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'))
    # Remove the old seeded category where nothing was ever recorded against it.
    op.execute("""DELETE FROM fin_categories c WHERE c.name = 'Purification / charity'
                  AND NOT EXISTS (SELECT 1 FROM fin_entries e WHERE e.category_id = c.id)""")


def downgrade() -> None:
    op.drop_table('fin_wishlist')
