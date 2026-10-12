"""bank import rows/rules, exam focus setting

Revision ID: d4f7b2a9e611
Revises: c3e8a1d5f902
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd4f7b2a9e611'
down_revision: Union[str, Sequence[str], None] = 'c3e8a1d5f902'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('fin_import_rows',
        sa.Column('id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('user_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('pocket_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('fp_key', sa.Text(), nullable=False),
        sa.Column('occurred_on', sa.Date(), nullable=False),
        sa.Column('amount_cents', sa.BigInteger(), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('status', sa.Text(), nullable=False),
        sa.Column('entry_id', sa.UUID(as_uuid=False), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('booked','skipped','linked')", name='chk_improw_status'),
        sa.ForeignKeyConstraint(['user_id', 'pocket_id'], ['fin_pockets.user_id', 'fin_pockets.id'], name='fk_improw_pocket_same_user', ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_fin_improw_user', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'fp_key', name='uq_improw_fp'))
    op.create_index('ix_improw_user_date', 'fin_import_rows', ['user_id', 'occurred_on'])
    op.create_table('fin_import_rules',
        sa.Column('id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('user_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('merchant_key', sa.Text(), nullable=False),
        sa.Column('category_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id', 'category_id'], ['fin_categories.user_id', 'fin_categories.id'], name='fk_imprule_cat_same_user', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_fin_imprule_user', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'merchant_key', name='uq_imprule_key'))
    op.add_column('users', sa.Column('exam_focus_days', sa.SmallInteger(), server_default='7', nullable=False))
    op.create_check_constraint('chk_exam_focus_days', 'users', 'exam_focus_days BETWEEN 0 AND 30')


def downgrade() -> None:
    op.drop_constraint('chk_exam_focus_days', 'users', type_='check')
    op.drop_column('users', 'exam_focus_days')
    op.drop_table('fin_import_rules')
    op.drop_index('ix_improw_user_date', table_name='fin_import_rows')
    op.drop_table('fin_import_rows')
