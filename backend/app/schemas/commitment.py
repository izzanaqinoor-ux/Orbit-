"""
Pydantic schemas for Commitment. The interesting design decision here is
the *create* schema: rather than one flat model with a pile of optional
fields and a comment saying "see chk_mode_fields for which combination is
valid," this uses a discriminated union on `mode` so an invalid
fixed/flexible field combination is rejected by FastAPI's request
validation with a clear 422 error — before it ever reaches the database.

The DB's `chk_mode_fields` CHECK constraint (Part A of the spec) remains
the actual source of truth and the last line of defense (e.g. against a
future second write path, like a bulk-import script, that skips this
schema entirely) — this is "validate early, enforce always," not
"validate here instead of in the database."
"""
from datetime import date, datetime
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, model_validator

from app.services.recurrence import InvalidRecurrenceRule, validate_rule


class CommitmentCreateFixed(BaseModel):
    """
    A fixed Commitment: a specific calendar slot. Directly occupies
    capacity; cannot carry demand-side fields (due_at, estimated duration).
    May optionally be a recurrence template (recurrence_rule set) — per
    chk_recurrence_fixed_template, only a fixed Commitment can be one.
    """
    mode: Literal["fixed"]
    title: str
    description: str | None = None
    category: Literal["study", "work", "personal", "other"] = "other"
    priority: int = Field(default=3, ge=1, le=5)  # 1 = highest, 5 = lowest
    goal_id: str | None = None
    planet_id: str | None = None
    time_off: bool = False

    start_at: datetime
    end_at: datetime

    # Recurrence — only meaningful on a fixed Commitment (chk_recurrence_fixed_template).
    # Setting this creates a template row; occurrences are expanded virtually and
    # materialized on touch via POST /commitments/{id}/occurrences/{date}.
    recurrence_rule: dict | None = None
    recurrence_end_date: date | None = None

    @model_validator(mode="after")
    def check_span(self) -> "CommitmentCreateFixed":
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        if self.recurrence_rule is not None:
            try:
                validate_rule(self.recurrence_rule)
            except InvalidRecurrenceRule as e:
                raise ValueError(str(e)) from e
        elif self.recurrence_end_date is not None:
            raise ValueError("recurrence_end_date requires a recurrence_rule")
        return self


class CommitmentCreateFlexible(BaseModel):
    """
    A flexible Commitment: a pool of demand with no fixed calendar slot of
    its own. Cannot be a recurrence template (chk_recurrence_fixed_template)
    and cannot directly carry start_at/end_at — TimeBlocks are the only
    calendar allocation mechanism for this Commitment's time.
    """
    mode: Literal["flexible"]
    title: str
    description: str | None = None
    category: Literal["study", "work", "personal", "other"] = "other"
    priority: int = Field(default=3, ge=1, le=5)
    goal_id: str | None = None
    planet_id: str | None = None

    estimated_duration_minutes: int = Field(ge=0)
    due_at: datetime | None = None
    # True when the user only chose a day; due_at is then the end of that local day.
    due_all_day: bool = False

    @model_validator(mode="after")
    def check_due(self) -> "CommitmentCreateFlexible":
        if self.due_all_day and self.due_at is None:
            raise ValueError("due_all_day needs a due date")
        return self

    model_config = {"extra": "forbid"}  # e.g. recurrence_rule on a flexible Commitment -> 422


CommitmentCreate = Annotated[
    Union[CommitmentCreateFixed, CommitmentCreateFlexible],
    Field(discriminator="mode"),
]


class CommitmentRead(BaseModel):
    id: str
    user_id: str
    title: str
    description: str | None
    mode: str
    status: str
    category: str
    priority: int
    start_at: datetime | None
    end_at: datetime | None
    due_at: datetime | None
    due_all_day: bool = False
    planet_id: str | None = None
    estimated_duration_minutes: int | None
    recurrence_rule: dict | None
    recurrence_end_date: date | None
    recurrence_template_id: str | None
    occurrence_date: date | None
    goal_id: str | None
    time_off: bool = False
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CommitmentUpdate(BaseModel):
    """Edit an existing commitment. Only the fields sent change; due_at may be sent as null to clear it."""
    title: str | None = None
    description: str | None = None
    priority: int | None = Field(default=None, ge=1, le=5)
    planet_id: str | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    estimated_duration_minutes: int | None = Field(default=None, ge=0)
    due_at: datetime | None = None
    due_all_day: bool | None = None
    time_off: bool | None = None

    model_config = {"extra": "forbid"}
