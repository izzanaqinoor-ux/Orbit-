"""
Pydantic schemas for TimeBlock. Deliberately minimal for this milestone:
creation only accepts start_at/end_at (a TimeBlock is always born `planned`
— per Part B, "rescheduling is an update to start_at/end_at, not a
status," and completing/skipping are separate state-transition actions,
not part of plain creation). Those transition endpoints
(`PATCH /time_blocks/{id}/complete`, `/skip`) are a follow-up, not built here.
"""
from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class TimeBlockCreate(BaseModel):
    start_at: datetime
    end_at: datetime

    @model_validator(mode="after")
    def check_span(self) -> "TimeBlockCreate":
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class TimeBlockComplete(BaseModel):
    """
    actual_duration_minutes is required here, not optional — this is the
    one field chk_tb_actual_consistency demands the moment status becomes
    'completed'. There's no sensible default (defaulting it to the planned
    duration would silently misrepresent Part B's whole point: actual can
    legitimately differ from planned).
    """
    actual_duration_minutes: int = Field(ge=0)


class TimeBlockRead(BaseModel):
    id: str
    commitment_id: str
    start_at: datetime
    end_at: datetime
    status: str
    actual_duration_minutes: int | None
    reschedule_count: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TimeBlockMove(BaseModel):
    """Reschedule a planned block: drag it, or stretch it longer or shorter."""
    start_at: datetime
    end_at: datetime

    @model_validator(mode="after")
    def check_span(self) -> "TimeBlockMove":
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self
