"""finance: income/currency on users, transactions, budget_limits, savings_goals

Orbit v2. Category lists are duplicated here on purpose: a migration is a
snapshot of the schema at one moment and must not import app code that may
change later.

Revision ID: 3c1f7a9d2b64
Revises: 0f59678cf00f
Create Date: 2026-10-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "3c1f7a9d2b64"
down_revision = "0f59678cf00f"
branch_labels = None
depends_on = None

EXPENSE = ("housing", "groceries", "transport", "utilities", "education", "health",
           "dining", "entertainment", "shopping", "subscriptions", "travel", "other", "savings")
INCOME = ("allowance", "job", "other_income")
BUDGETABLE = tuple(c for c in EXPENSE if c != "savings")
q = lambda xs: ", ".join(f"'{x}'" for x in xs)  # noqa: E731
UUID = postgresql.UUID(as_uuid=False)
NOW = sa.func.now()


def upgrade() -> None:
    op.add_column("users", sa.Column("monthly_income_cents", sa.BigInteger(), nullable=True))
    op.add_column("users", sa.Column("currency", sa.Text(), nullable=False, server_default="SGD"))
    op.create_check_constraint("chk_income_nonneg", "users", "monthly_income_cents IS NULL OR monthly_income_cents >= 0")
    op.create_check_constraint("chk_currency_code", "users", "currency ~ '^[A-Z]{3}$'")

    op.create_table(
        "savings_goals",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False, server_default="general"),
        sa.Column("target_cents", sa.BigInteger(), nullable=False),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_savings_goals_user"),
        sa.UniqueConstraint("user_id", "id", name="uq_savings_goals_user_id"),
        sa.CheckConstraint("target_cents > 0", name="chk_goal_target_positive"),
        sa.CheckConstraint("kind IN ('emergency', 'general')", name="chk_goal_kind"),
        sa.CheckConstraint("status IN ('active', 'archived')", name="chk_goal_status"),
    )
    op.create_table(
        "transactions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("amount_cents", sa.BigInteger(), nullable=False),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("recurring", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("savings_goal_id", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_transactions_user"),
        sa.ForeignKeyConstraint(["user_id", "savings_goal_id"], ["savings_goals.user_id", "savings_goals.id"],
                                name="fk_transactions_goal_same_user", ondelete="RESTRICT"),
        sa.CheckConstraint("amount_cents > 0", name="chk_tx_amount_positive"),
        sa.CheckConstraint(
            f"(kind = 'income' AND category IN ({q(INCOME)})) OR (kind = 'expense' AND category IN ({q(EXPENSE)}))",
            name="chk_tx_kind_category"),
        sa.CheckConstraint("savings_goal_id IS NULL OR category = 'savings'", name="chk_tx_goal_only_savings"),
    )
    op.create_index("ix_transactions_user_date", "transactions", ["user_id", "occurred_on"])
    op.create_table(
        "budget_limits",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("monthly_limit_cents", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_budget_limits_user"),
        sa.UniqueConstraint("user_id", "category", name="uq_budget_user_category"),
        sa.CheckConstraint("monthly_limit_cents >= 0", name="chk_budget_nonneg"),
        sa.CheckConstraint(f"category IN ({q(BUDGETABLE)})", name="chk_budget_category"),
    )


def downgrade() -> None:
    op.drop_table("budget_limits")
    op.drop_index("ix_transactions_user_date", table_name="transactions")
    op.drop_table("transactions")
    op.drop_table("savings_goals")
    op.drop_constraint("chk_currency_code", "users")
    op.drop_constraint("chk_income_nonneg", "users")
    op.drop_column("users", "currency")
    op.drop_column("users", "monthly_income_cents")
