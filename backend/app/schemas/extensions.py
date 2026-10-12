from datetime import datetime

from pydantic import BaseModel, Field


class AssignmentCreate(BaseModel):
    module_id: str | None = None
    weightage_percent: float | None = Field(default=None, ge=0, le=100)
    grade: float | None = Field(default=None, ge=0, le=100)


class AssignmentRead(BaseModel):
    id: str
    user_id: str
    commitment_id: str
    module_id: str | None
    weightage_percent: float | None
    grade: float | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ExamCreate(BaseModel):
    module_id: str | None = None
    weightage_percent: float | None = Field(default=None, ge=0, le=100)
    grade: float | None = Field(default=None, ge=0, le=100)


class ExamRead(BaseModel):
    id: str
    user_id: str
    commitment_id: str
    module_id: str | None
    weightage_percent: float | None
    grade: float | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ShiftCreate(BaseModel):
    job_id: str | None = None
    hourly_rate_override: float | None = Field(default=None, ge=0)


class ShiftRead(BaseModel):
    id: str
    user_id: str
    commitment_id: str
    job_id: str | None
    hourly_rate_override: float | None
    created_at: datetime

    model_config = {"from_attributes": True}
