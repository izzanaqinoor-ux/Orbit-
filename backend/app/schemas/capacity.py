from datetime import datetime

from pydantic import BaseModel


class CommitmentDemandRead(BaseModel):
    commitment_id: str
    title: str
    due_at: datetime | None
    estimated_duration_minutes: float
    actual_minutes: float
    planned_total_minutes: float
    planned_valid_minutes: float
    remaining_demand_minutes: float
    unallocated_demand_minutes: float
    unfulfilled_deadline_demand_minutes: float


class WeekCapacityRead(BaseModel):
    week_start: datetime
    week_end: datetime
    weekly_capacity_minutes: float
    fixed_occupied_minutes: float
    planned_allocation_minutes: float
    occupied_minutes: float
    deadline_pressure_minutes: float
    free_capacity_minutes: float
    per_commitment_demand: list[CommitmentDemandRead]
