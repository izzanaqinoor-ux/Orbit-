from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Cents = int


class PocketIn(BaseModel):
    name: str = Field(min_length=1)
    role: Literal["spending", "savings", "earmarked"] = "savings"
    purpose: Literal["main", "emergency", "travel", "general", "earmarked", "other"] = "other"
    provider: str | None = None
    is_liquid: bool = True
    opening_cents: Cents = Field(default=0, ge=0)


class PocketPatch(BaseModel):
    name: str | None = None
    provider: str | None = None
    is_liquid: bool | None = None
    opening_cents: Cents | None = Field(default=None, ge=0)
    archived: bool | None = None


class CategoryIn(BaseModel):
    name: str = Field(min_length=1)
    kind: Literal["income", "expense"] = "expense"
    counts_toward_cap: bool = True


class CategoryPatch(BaseModel):
    name: str | None = None
    counts_toward_cap: bool | None = None
    archived: bool | None = None


class HoldingIn(BaseModel):
    ticker: str = Field(min_length=1)
    name: str | None = None
    opening_units: Decimal = Field(default=Decimal(0), ge=0)
    opening_cost_cents: Cents = Field(default=0, ge=0)
    shariah_note: str | None = None

    @field_validator("ticker")
    @classmethod
    def up(cls, v: str) -> str:
        return v.strip().upper()


class HoldingPatch(BaseModel):
    name: str | None = None
    price_cents: Cents | None = Field(default=None, ge=0)
    price_as_of: date | None = None
    opening_units: Decimal | None = Field(default=None, ge=0)
    opening_cost_cents: Cents | None = Field(default=None, ge=0)
    shariah_note: str | None = None
    archived: bool | None = None


class EntryIn(BaseModel):
    kind: Literal["income", "expense", "transfer", "contribution", "dividend"]
    amount_cents: Cents = Field(gt=0)
    occurred_on: date | None = None
    note: str | None = None
    category_id: str | None = None
    from_pocket_id: str | None = None
    to_pocket_id: str | None = None
    holding_id: str | None = None
    units: Decimal | None = Field(default=None, gt=0)
    recurring: bool = False


class EntryOut(BaseModel):
    id: str
    kind: str
    amount_cents: int
    occurred_on: date
    note: str | None
    category_id: str | None
    from_pocket_id: str | None
    to_pocket_id: str | None
    holding_id: str | None
    units: Decimal | None
    recurring: bool
    model_config = {"from_attributes": True}


class GoalIn(BaseModel):
    title: str = Field(min_length=1)
    kind: Literal["pocket", "investments", "net_worth", "custom"] = "pocket"
    pocket_id: str | None = None
    target_cents: Cents = Field(gt=0)
    target_date: date | None = None
    planned_monthly_cents: Cents | None = Field(default=None, ge=0)
    manual_current_cents: Cents | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def need_pocket(self):
        if self.kind == "pocket" and not self.pocket_id:
            raise ValueError("A pocket goal needs a pocket.")
        return self


class GoalPatch(BaseModel):
    title: str | None = None
    target_cents: Cents | None = Field(default=None, gt=0)
    target_date: date | None = None
    planned_monthly_cents: Cents | None = Field(default=None, ge=0)
    manual_current_cents: Cents | None = Field(default=None, ge=0)
    archived: bool | None = None


# ── rules ──
class AllocLine(BaseModel):
    key: str
    label: str
    pct: float = Field(ge=0, le=100)
    source: Literal["spending", "pocket", "investment"]
    purpose: str | None = None


class PortLine(BaseModel):
    ticker: str
    pct: float = Field(ge=0, le=100)

    @field_validator("ticker")
    @classmethod
    def up(cls, v: str) -> str:
        return v.strip().upper()


class SaveRange(BaseModel):
    low_cents: Cents = Field(ge=0)
    high_cents: Cents = Field(ge=0)


class Conditions(BaseModel):
    liquidity_first: bool = True
    cap_warning: bool = True
    underweight_first: bool = True
    redirect_to: str = "emergency"


class RuleConfig(BaseModel):
    spending_cap_cents: Cents = Field(ge=0)
    liquidity_floor_cents: Cents = Field(ge=0)
    liquidity_comfort_cents: Cents | None = Field(default=None, ge=0)
    min_contribution_cents: Cents = Field(ge=0)
    save_invest_target: SaveRange
    tolerance_pp: float = Field(default=5, ge=0, le=50)
    allocation: list[AllocLine]
    portfolio: list[PortLine]
    conditions: Conditions = Conditions()

    @model_validator(mode="after")
    def checks(self):
        if self.portfolio and abs(sum(p.pct for p in self.portfolio) - 100) > 0.01:
            raise ValueError("Portfolio targets must add up to 100%.")
        keys = [a.key for a in self.allocation]
        if len(set(keys)) != len(keys):
            raise ValueError("Allocation keys must be unique.")
        if self.allocation and sum(a.pct for a in self.allocation) > 100.01:
            raise ValueError("Allocation can't exceed 100%.")
        if self.liquidity_comfort_cents is not None and self.liquidity_comfort_cents < self.liquidity_floor_cents:
            raise ValueError("Comfortable cash level should not be below the minimum buffer.")
        return self


class RulesIn(BaseModel):
    config: RuleConfig
    note: str | None = None


class RuleSetOut(BaseModel):
    id: str
    name: str
    status: str
    effective_from: date | None
    effective_to: date | None
    note: str | None
    config: dict
    model_config = {"from_attributes": True}


class MilestoneIn(BaseModel):
    age: int = Field(ge=10, le=100)
    nw_low_cents: Cents = Field(ge=0)
    nw_high_cents: Cents | None = Field(default=None, ge=0)
    note: str | None = None


class MilestoneOut(MilestoneIn):
    id: str
    model_config = {"from_attributes": True}


class GrowthParams(BaseModel):
    start_cents: Cents = Field(default=0, ge=0)
    monthly_cents: Cents = Field(ge=0)
    years: int = Field(ge=1, le=60)
    rates_pct: list[float] = Field(min_length=1, max_length=4)


class PropertyParams(BaseModel):
    price_cents: Cents = Field(gt=0)
    down_pct: float = Field(ge=0, le=100)
    loan_rate_pct: float = Field(ge=0, le=30)
    tenure_years: int = Field(ge=1, le=40)
    monthly_save_cents: Cents = Field(default=0, ge=0)


class ScenarioIn(BaseModel):
    name: str = Field(min_length=1)
    kind: Literal["growth", "property"]
    params: dict


class ScenarioOut(BaseModel):
    id: str
    name: str
    kind: str
    params: dict
    result: dict
    created_at: datetime


class IncomeSourceIn(BaseModel):
    name: str = Field(min_length=1)
    kind: Literal["part_time", "allowance", "internship", "full_time", "freelance", "other"] = "allowance"
    monthly_cents: Cents = Field(ge=0)
    pays_in_term: bool = True
    pays_in_break: bool = True
    active: bool = True


class IncomeSourceOut(IncomeSourceIn):
    id: str
    model_config = {"from_attributes": True}


class BalanceIn(BaseModel):
    name: str = Field(min_length=1)
    kind: Literal["asset", "liability"]
    balance_cents: Cents = Field(ge=0)


class BalanceOut(BalanceIn):
    id: str
    model_config = {"from_attributes": True}


class SettingsIn(BaseModel):
    birth_date: date | None = None
    valuation_day: int | None = Field(default=None, ge=1, le=28)
    exam_focus_days: int | None = Field(default=None, ge=0, le=30)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")


class PlanReq(BaseModel):
    name: str | None = None
    price_cents: Cents = Field(gt=0)
    category_id: str
    pocket_id: str | None = None


class WishIn(BaseModel):
    name: str = Field(min_length=1)
    price_cents: Cents = Field(gt=0)
    category_id: str
    note: str | None = None


class WishPatch(BaseModel):
    name: str | None = None
    price_cents: Cents | None = Field(default=None, gt=0)
    note: str | None = None
    archived: bool | None = None


class SettleItem(BaseModel):
    pocket_id: str
    actual_cents: Cents = Field(ge=0)
    destination_pocket_id: str | None = None


class SettleIn(BaseModel):
    items: list[SettleItem] = Field(min_length=1)


class ValueItem(BaseModel):
    holding_id: str
    value_cents: Cents = Field(ge=0)


class ValuesIn(BaseModel):
    month: str | None = None
    values: list[ValueItem] = Field(min_length=1)


class ImportRowIn(BaseModel):
    pocket_id: str
    date: date
    amount_cents: Cents
    description: str = ""
    balance_cents: Cents | None = None

    @field_validator("amount_cents")
    @classmethod
    def nonzero(cls, v: int) -> int:
        if v == 0:
            raise ValueError("A line can't be zero.")
        return v


class ImportPreviewIn(BaseModel):
    rows: list[ImportRowIn] = Field(max_length=3000)


class ImportCommitRow(ImportRowIn):
    action: Literal["expense", "income", "transfer", "skip", "link"]
    category_id: str | None = None
    other_pocket_id: str | None = None
    pair_key: str | None = None
    link_entry_id: str | None = None


class ImportCommitIn(BaseModel):
    rows: list[ImportCommitRow] = Field(min_length=1, max_length=3000)
