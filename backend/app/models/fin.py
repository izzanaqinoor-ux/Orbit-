"""
Personal finance ("financial operating system"). Money is integer cents (BIGINT).
Nothing derived is stored except month-end snapshots (needed because history can't be rebuilt
from today's prices): balances, net worth, goal progress and allocations are computed on read.
"""
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKeyConstraint, Index, Integer,
                        Numeric, SmallInteger, Text, UniqueConstraint, func, text)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.ids import generate_uuid7
from app.db.base import Base, CreatedAtMixin

_id = lambda: mapped_column(UUID(as_uuid=False), primary_key=True, default=generate_uuid7)  # noqa: E731
_uid = lambda: mapped_column(UUID(as_uuid=False), nullable=False)  # noqa: E731
_ref = lambda: mapped_column(UUID(as_uuid=False), nullable=True)  # noqa: E731

POCKET_ROLES = ("spending", "savings", "earmarked")
POCKET_PURPOSES = ("main", "emergency", "travel", "general", "earmarked", "other")
ENTRY_KINDS = ("income", "expense", "transfer", "contribution", "dividend")
GOAL_KINDS = ("pocket", "investments", "net_worth", "custom")
INCOME_KINDS = ("part_time", "allowance", "internship", "full_time", "freelance", "other")


class Pocket(Base, CreatedAtMixin):
    __tablename__ = "fin_pockets"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_fin_pockets_user", ondelete="CASCADE"),
        UniqueConstraint("user_id", "id", name="uq_fin_pockets_user_id"),
        UniqueConstraint("user_id", "name", name="uq_fin_pocket_name"),
        CheckConstraint("role IN ('spending','savings','earmarked')", name="chk_pocket_role"),
        CheckConstraint("purpose IN ('main','emergency','travel','general','earmarked','other')", name="chk_pocket_purpose"),
        CheckConstraint("opening_cents >= 0", name="chk_pocket_opening"),
    )
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _uid()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False, default="other")
    provider: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_liquid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    opening_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class FinCategory(Base, CreatedAtMixin):
    __tablename__ = "fin_categories"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_fin_categories_user", ondelete="CASCADE"),
        UniqueConstraint("user_id", "id", name="uq_fin_categories_user_id"),
        UniqueConstraint("user_id", "kind", "name", name="uq_fin_category_name"),
        CheckConstraint("kind IN ('income','expense')", name="chk_fincat_kind"),
        CheckConstraint("kind = 'expense' OR counts_toward_cap = false", name="chk_fincat_cap_only_expense"),
    )
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _uid()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    counts_toward_cap: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Holding(Base, CreatedAtMixin):
    __tablename__ = "fin_holdings"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_fin_holdings_user", ondelete="CASCADE"),
        UniqueConstraint("user_id", "id", name="uq_fin_holdings_user_id"),
        UniqueConstraint("user_id", "ticker", name="uq_fin_holding_ticker"),
        CheckConstraint("opening_units >= 0 AND opening_cost_cents >= 0", name="chk_holding_opening"),
        CheckConstraint("price_cents IS NULL OR price_cents >= 0", name="chk_holding_price"),
    )
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _uid()
    ticker: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    price_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)   # per unit, entered by the user
    price_as_of: Mapped[date | None] = mapped_column(Date, nullable=True)
    opening_units: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False, default=0)
    opening_cost_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    shariah_note: Mapped[str | None] = mapped_column(Text, nullable=True)       # the user's own screening notes
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Entry(Base, CreatedAtMixin):
    __tablename__ = "fin_entries"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_fin_entries_user", ondelete="CASCADE"),
        ForeignKeyConstraint(["user_id", "category_id"], ["fin_categories.user_id", "fin_categories.id"], name="fk_entry_category_same_user", ondelete="RESTRICT"),
        ForeignKeyConstraint(["user_id", "from_pocket_id"], ["fin_pockets.user_id", "fin_pockets.id"], name="fk_entry_from_same_user", ondelete="RESTRICT"),
        ForeignKeyConstraint(["user_id", "to_pocket_id"], ["fin_pockets.user_id", "fin_pockets.id"], name="fk_entry_to_same_user", ondelete="RESTRICT"),
        ForeignKeyConstraint(["user_id", "holding_id"], ["fin_holdings.user_id", "fin_holdings.id"], name="fk_entry_holding_same_user", ondelete="RESTRICT"),
        CheckConstraint("amount_cents > 0", name="chk_entry_amount"),
        CheckConstraint("units IS NULL OR units > 0", name="chk_entry_units"),
        CheckConstraint(
            """
            (kind = 'income'       AND category_id IS NOT NULL AND to_pocket_id IS NOT NULL AND from_pocket_id IS NULL AND holding_id IS NULL)
         OR (kind = 'expense'      AND category_id IS NOT NULL AND from_pocket_id IS NOT NULL AND to_pocket_id IS NULL AND holding_id IS NULL)
         OR (kind = 'transfer'     AND category_id IS NULL AND from_pocket_id IS NOT NULL AND to_pocket_id IS NOT NULL
                                   AND from_pocket_id <> to_pocket_id AND holding_id IS NULL)
         OR (kind = 'contribution' AND holding_id IS NOT NULL AND category_id IS NULL AND to_pocket_id IS NULL)
         OR (kind = 'dividend'     AND holding_id IS NOT NULL AND category_id IS NULL AND from_pocket_id IS NULL)
            """,
            name="chk_entry_shape",
        ),
        Index("ix_fin_entries_user_date", "user_id", "occurred_on"),
    )
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _uid()
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    occurred_on: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    category_id: Mapped[str | None] = _ref()
    from_pocket_id: Mapped[str | None] = _ref()
    to_pocket_id: Mapped[str | None] = _ref()
    holding_id: Mapped[str | None] = _ref()
    units: Mapped[Decimal | None] = mapped_column(Numeric(18, 6), nullable=True)   # units bought (contribution)
    recurring: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class FinGoal(Base, CreatedAtMixin):
    __tablename__ = "fin_goals"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_fin_goals_user", ondelete="CASCADE"),
        ForeignKeyConstraint(["user_id", "pocket_id"], ["fin_pockets.user_id", "fin_pockets.id"], name="fk_goal_pocket_same_user", ondelete="RESTRICT"),
        CheckConstraint("kind IN ('pocket','investments','net_worth','custom')", name="chk_fingoal_kind"),
        CheckConstraint("kind <> 'pocket' OR pocket_id IS NOT NULL", name="chk_fingoal_pocket"),
        CheckConstraint("target_cents > 0", name="chk_fingoal_target"),
        CheckConstraint("planned_monthly_cents IS NULL OR planned_monthly_cents >= 0", name="chk_fingoal_plan"),
    )
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _uid()
    title: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    pocket_id: Mapped[str | None] = _ref()
    target_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_monthly_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    manual_current_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class RuleSet(Base, CreatedAtMixin):
    """One versioned bundle of the user's rules. Exactly one is 'current'; the rest are history."""
    __tablename__ = "fin_rule_sets"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_fin_rules_user", ondelete="CASCADE"),
        CheckConstraint("status IN ('current','historical')", name="chk_rules_status"),
        Index("uq_one_current_ruleset", "user_id", unique=True, postgresql_where=text("status = 'current'")),
    )
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _uid()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    effective_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False)


class Milestone(Base, CreatedAtMixin):
    __tablename__ = "fin_milestones"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_fin_milestones_user", ondelete="CASCADE"),
        UniqueConstraint("user_id", "age", name="uq_fin_milestone_age"),
        CheckConstraint("nw_low_cents >= 0 AND (nw_high_cents IS NULL OR nw_high_cents >= nw_low_cents)", name="chk_milestone_range"),
    )
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _uid()
    age: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    nw_low_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    nw_high_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class Scenario(Base, CreatedAtMixin):
    __tablename__ = "fin_scenarios"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_fin_scenarios_user", ondelete="CASCADE"),
        CheckConstraint("kind IN ('growth','property')", name="chk_scenario_kind"),
    )
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _uid()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    params: Mapped[dict] = mapped_column(JSONB, nullable=False)


class IncomeSource(Base, CreatedAtMixin):
    """Recurring income that isn't a Job (allowance, stipend, side income)."""
    __tablename__ = "fin_income_sources"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_fin_income_user", ondelete="CASCADE"),
        CheckConstraint("kind IN ('part_time','allowance','internship','full_time','freelance','other')", name="chk_income_kind"),
        CheckConstraint("monthly_cents >= 0", name="chk_income_amount"),
    )
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _uid()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    monthly_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    pays_in_term: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    pays_in_break: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class BalanceItem(Base, CreatedAtMixin):
    """Other assets and liabilities (credit card, loan, ...)."""
    __tablename__ = "fin_balance_items"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_fin_balance_user", ondelete="CASCADE"),
        CheckConstraint("kind IN ('asset','liability')", name="chk_balance_kind"),
        CheckConstraint("balance_cents >= 0", name="chk_balance_nonneg"),
    )
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _uid()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    balance_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)


class Snapshot(Base, CreatedAtMixin):
    """Month-end (or month-to-date) net-worth snapshot: the only stored derived data."""
    __tablename__ = "fin_snapshots"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_fin_snapshots_user", ondelete="CASCADE"),
        UniqueConstraint("user_id", "month", name="uq_fin_snapshot_month"),
    )
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _uid()
    month: Mapped[date] = mapped_column(Date, nullable=False)
    net_worth_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    cash_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    investments_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class WishlistItem(Base, CreatedAtMixin):
    """Things considered but not bought (yet). Re-checked against current rules on read."""
    __tablename__ = "fin_wishlist"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_fin_wishlist_user", ondelete="CASCADE"),
        ForeignKeyConstraint(["user_id", "category_id"], ["fin_categories.user_id", "fin_categories.id"], name="fk_wish_category_same_user", ondelete="RESTRICT"),
        CheckConstraint("price_cents > 0", name="chk_wish_price"),
    )
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _uid()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    price_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    category_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class MonthClose(Base, CreatedAtMixin):
    """A reconciliation of one pocket for one month: what the books said vs what you actually have."""
    __tablename__ = "fin_month_closes"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_fin_close_user", ondelete="CASCADE"),
        ForeignKeyConstraint(["user_id", "pocket_id"], ["fin_pockets.user_id", "fin_pockets.id"], name="fk_close_pocket_same_user", ondelete="RESTRICT"),
        UniqueConstraint("user_id", "month", "pocket_id", name="uq_close_month_pocket"),
        CheckConstraint("cap_cut_cents >= 0", name="chk_close_cut"),
    )
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _uid()
    month: Mapped[date] = mapped_column(Date, nullable=False)
    pocket_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    expected_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)   # books before settling
    actual_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    diff_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)       # actual - expected
    destination_pocket_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    cap_cut_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)  # applied to the NEXT month's cap
    entry_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)


class Valuation(Base, CreatedAtMixin):
    """What a holding was worth on the monthly check-in. For bookkeeping, not for trading signals."""
    __tablename__ = "fin_valuations"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_fin_val_user", ondelete="CASCADE"),
        ForeignKeyConstraint(["user_id", "holding_id"], ["fin_holdings.user_id", "fin_holdings.id"], name="fk_val_holding_same_user", ondelete="RESTRICT"),
        UniqueConstraint("user_id", "holding_id", "month", name="uq_val_holding_month"),
        CheckConstraint("value_cents >= 0", name="chk_val_value"),
    )
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _uid()
    holding_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    month: Mapped[date] = mapped_column(Date, nullable=False)
    value_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    recorded_on: Mapped[date] = mapped_column(Date, nullable=False)


class ImportRow(Base, CreatedAtMixin):
    """A bank-statement line we've already dealt with, so re-uploading overlapping statements never double-counts."""
    __tablename__ = "fin_import_rows"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_fin_improw_user", ondelete="CASCADE"),
        ForeignKeyConstraint(["user_id", "pocket_id"], ["fin_pockets.user_id", "fin_pockets.id"], name="fk_improw_pocket_same_user", ondelete="RESTRICT"),
        UniqueConstraint("user_id", "fp_key", name="uq_improw_fp"),
        CheckConstraint("status IN ('booked','skipped','linked')", name="chk_improw_status"),
    )
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _uid()
    pocket_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    fp_key: Mapped[str] = mapped_column(Text, nullable=False)
    occurred_on: Mapped[date] = mapped_column(Date, nullable=False)
    amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)       # signed: + into the account, - out of it
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(Text, nullable=False)                   # booked | skipped | linked (matched an entry you'd already logged)
    entry_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)


class ImportRule(Base, CreatedAtMixin):
    """Remembers 'this merchant is usually that category' from your past imports."""
    __tablename__ = "fin_import_rules"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_fin_imprule_user", ondelete="CASCADE"),
        ForeignKeyConstraint(["user_id", "category_id"], ["fin_categories.user_id", "fin_categories.id"], name="fk_imprule_cat_same_user", ondelete="CASCADE"),
        UniqueConstraint("user_id", "merchant_key", name="uq_imprule_key"),
    )
    id: Mapped[str] = _id()
    user_id: Mapped[str] = _uid()
    merchant_key: Mapped[str] = mapped_column(Text, nullable=False)
    category_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
