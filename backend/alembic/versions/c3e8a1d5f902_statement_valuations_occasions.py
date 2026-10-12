"""month closes, valuations, occasions, valuation day

Revision ID: c3e8a1d5f902
Revises: 9c4f1a7e2b63
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'c3e8a1d5f902'
down_revision: Union[str, Sequence[str], None] = '9c4f1a7e2b63'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('fin_month_closes',
        sa.Column('id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('user_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('month', sa.Date(), nullable=False),
        sa.Column('pocket_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('expected_cents', sa.BigInteger(), nullable=False),
        sa.Column('actual_cents', sa.BigInteger(), nullable=False),
        sa.Column('diff_cents', sa.BigInteger(), nullable=False),
        sa.Column('destination_pocket_id', sa.UUID(as_uuid=False), nullable=True),
        sa.Column('cap_cut_cents', sa.BigInteger(), nullable=False),
        sa.Column('entry_ids', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint('cap_cut_cents >= 0', name='chk_close_cut'),
        sa.ForeignKeyConstraint(['user_id', 'pocket_id'], ['fin_pockets.user_id', 'fin_pockets.id'], name='fk_close_pocket_same_user', ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_fin_close_user', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'month', 'pocket_id', name='uq_close_month_pocket'))
    op.create_table('fin_valuations',
        sa.Column('id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('user_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('holding_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('month', sa.Date(), nullable=False),
        sa.Column('value_cents', sa.BigInteger(), nullable=False),
        sa.Column('recorded_on', sa.Date(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint('value_cents >= 0', name='chk_val_value'),
        sa.ForeignKeyConstraint(['user_id', 'holding_id'], ['fin_holdings.user_id', 'fin_holdings.id'], name='fk_val_holding_same_user', ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_fin_val_user', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'holding_id', 'month', name='uq_val_holding_month'))
    op.create_table('occasions',
        sa.Column('id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('user_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('title', sa.Text(), nullable=False),
        sa.Column('occurs_on', sa.Date(), nullable=False),
        sa.Column('occurs_time', sa.Time(), nullable=True),
        sa.Column('repeats_yearly', sa.Boolean(), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint('length(trim(title)) > 0', name='chk_occasion_title'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_occasions_user', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'))
    op.add_column('users', sa.Column('valuation_day', sa.SmallInteger(), server_default='1', nullable=False))
    op.create_check_constraint('chk_valuation_day', 'users', 'valuation_day BETWEEN 1 AND 28')


def downgrade() -> None:
    op.drop_constraint('chk_valuation_day', 'users', type_='check')
    op.drop_column('users', 'valuation_day')
    for t in ('occasions', 'fin_valuations', 'fin_month_closes'):
        op.drop_table(t)
