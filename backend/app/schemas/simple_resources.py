"""
Schemas for Goal, Module, Job — grouped in one file because each is a
small, single-purpose resource with no mode-dependent branching (unlike
Commitment). Splitting these into three near-identical files would be
more ceremony than the content justifies.
"""
from datetime import date, datetime

from typing import Literal

from pydantic import BaseModel, Field


class GoalCreate(BaseModel):
    title: str
    target_value: float | None = None
    current_value: float = 0
    target_date: date | None = None
    kind: Literal["assignment", "exam"] | None = None
    source_name: str | None = None


class GoalUpdate(BaseModel):
    title: str | None = None
    target_value: float | None = None
    current_value: float | None = None
    target_date: date | None = None


class GoalRead(BaseModel):
    id: str
    user_id: str
    title: str
    target_value: float | None
    current_value: float
    target_date: date | None
    kind: str | None = None
    source_name: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ModuleCreate(BaseModel):
    name: str
    code: str | None = None


class ModuleRead(BaseModel):
    id: str
    user_id: str
    name: str
    code: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class JobCreate(BaseModel):
    name: str
    hourly_rate: float | None = Field(default=None, ge=0)
    pay_basis: Literal["hourly", "monthly"] = "hourly"
    monthly_pay: float | None = Field(default=None, ge=0)
    unpaid_break_minutes: int = Field(default=0, ge=0)
    break_after_minutes: int = Field(default=480, ge=0)


class JobRead(BaseModel):
    id: str
    user_id: str
    name: str
    hourly_rate: float | None
    pay_basis: str
    monthly_pay: float | None
    unpaid_break_minutes: int
    break_after_minutes: int
    is_main: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}
