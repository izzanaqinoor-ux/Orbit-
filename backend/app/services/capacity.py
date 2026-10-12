"""
The capacity/demand math itself — Part F/G of the schema spec and the
locked mathematical model, made real. Every metric here is computed live
from `commitments`/`time_blocks`; nothing here is a stored column, per the
spec's explicit "prefer derived" rule.

FixedOccupied(W) = real fixed rows (ordinary fixed Commitments and
materialized occurrences, both `recurrence_rule IS NULL`) PLUS virtual
occurrences of active recurrence templates that are neither excepted nor
already materialized (see recurrence_service). Templates themselves are
patterns, never occupancy.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.commitment import Commitment
from app.models.time_block import TimeBlock
from app.models.user import User
from app.services.recurrence_service import virtual_occurrences


def get_week_bounds(tz_name: str, now: datetime | None = None) -> tuple[datetime, datetime]:
    """
    W, locked precisely per Part F: one complete user-local calendar week,
    Monday 00:00 through the following Monday 00:00 (exclusive), evaluated
    in the user's own IANA timezone — never a rolling 7-day window.
    Returns (start_utc, end_utc) as tz-aware UTC datetimes, since every
    stored timestamp is TIMESTAMPTZ / UTC internally (Part G).
    """
    tz = ZoneInfo(tz_name)
    local_now = (now or datetime.now(dt_timezone.utc)).astimezone(tz)
    monday = local_now.date() - timedelta(days=local_now.weekday())
    week_start_local = datetime(monday.year, monday.month, monday.day, tzinfo=tz)
    week_end_local = week_start_local + timedelta(days=7)
    return week_start_local.astimezone(dt_timezone.utc), week_end_local.astimezone(dt_timezone.utc)


def is_all_day(start: datetime, end: datetime, tz: ZoneInfo) -> bool:
    """Whole local days: both ends on a local midnight and at least ~one day long (tolerates DST)."""
    s, e = start.astimezone(tz), end.astimezone(tz)
    midnight = lambda d: d.hour == 0 and d.minute == 0
    return midnight(s) and midnight(e) and (end - start) >= timedelta(hours=23)


def _overlap_minutes(a_start: datetime, a_end: datetime, w_start: datetime, w_end: datetime) -> float:
    """
    Minutes of [a_start, a_end) that fall inside [w_start, w_end). This is
    the mechanism behind the earlier-locked week-boundary rule: an interval
    that straddles a week boundary contributes only its in-week portion to
    that week, not the whole thing.
    """
    start = max(a_start, w_start)
    end = min(a_end, w_end)
    return max(0.0, (end - start).total_seconds() / 60)


@dataclass
class CommitmentDemand:
    commitment_id: str
    title: str
    due_at: datetime | None
    due_all_day: bool
    estimated_duration_minutes: float  # E(c)
    actual_minutes: float              # A(c)
    planned_total_minutes: float       # P_total(c)
    planned_valid_minutes: float       # P_valid(c)
    remaining_demand_minutes: float
    unallocated_demand_minutes: float
    unfulfilled_deadline_demand_minutes: float


def compute_commitment_demand(db: Session, commitment: Commitment) -> CommitmentDemand:
    """
    E(c), A(c), P_total(c), P_valid(c), and everything derived from them,
    for one flexible Commitment. Matches the locked mathematical model's
    equations exactly — including the two corrections from the math-audit
    and correction-pass-1 checkpoints: RemainingDemand forced to 0 for both
    'completed' AND 'skipped' status, and P_valid computed against
    due_at rather than reusing P_total when a deadline exists.
    """
    if commitment.mode != "flexible":
        raise ValueError("compute_commitment_demand is only meaningful for flexible Commitments")

    time_blocks = list(
        db.execute(select(TimeBlock).where(TimeBlock.commitment_id == commitment.id)).scalars().all()
    )

    E = float(commitment.estimated_duration_minutes or 0)

    A = sum(
        float(tb.actual_duration_minutes or 0) for tb in time_blocks if tb.status == "completed"
    )

    planned = [tb for tb in time_blocks if tb.status == "planned"]
    P_total = sum((tb.end_at - tb.start_at).total_seconds() / 60 for tb in planned)

    if commitment.due_at is not None:
        due_at = commitment.due_at
        P_valid = sum(
            max(0.0, (min(tb.end_at, due_at) - tb.start_at).total_seconds() / 60)
            for tb in planned
        )
    else:
        P_valid = P_total

    if commitment.status in ("completed", "skipped"):
        remaining_demand = 0.0
    else:
        remaining_demand = max(0.0, E - A)

    unallocated_demand = max(0.0, remaining_demand - P_total)
    unfulfilled_deadline_demand = max(0.0, remaining_demand - P_valid)

    return CommitmentDemand(
        commitment_id=commitment.id,
        title=commitment.title,
        due_at=commitment.due_at,
        due_all_day=commitment.due_all_day,
        estimated_duration_minutes=E,
        actual_minutes=A,
        planned_total_minutes=P_total,
        planned_valid_minutes=P_valid,
        remaining_demand_minutes=remaining_demand,
        unallocated_demand_minutes=unallocated_demand,
        unfulfilled_deadline_demand_minutes=unfulfilled_deadline_demand,
    )


@dataclass
class WeekCapacitySnapshot:
    week_start: datetime
    week_end: datetime
    weekly_capacity_minutes: float
    fixed_occupied_minutes: float
    planned_allocation_minutes: float
    occupied_minutes: float
    deadline_pressure_minutes: float
    free_capacity_minutes: float
    per_commitment_demand: list[CommitmentDemand]


def compute_week_capacity(db: Session, user: User, now: datetime | None = None) -> WeekCapacitySnapshot:
    week_start, week_end = get_week_bounds(user.timezone, now)

    # FixedOccupied(W) — non-template fixed Commitments overlapping W.
    # `recurrence_rule IS NULL` excludes template rows (Part D's locked
    # semantic rule: a template is a pattern definition, never itself
    # occupied calendar time) while correctly including both ordinary
    # fixed Commitments and already-materialized occurrences.
    tz = ZoneInfo(user.timezone)
    fixed_rows = db.execute(
        select(Commitment.start_at, Commitment.end_at).where(
            Commitment.user_id == user.id,
            Commitment.mode == "fixed",
            Commitment.recurrence_rule.is_(None),
            Commitment.start_at < week_end,
            Commitment.end_at > week_start,
        )
    ).all()
    # An all-day (or several-day) event is a marker on the calendar: a trip, a holiday, a public day off.
    # It is stored as local midnight to local midnight and does not eat the working-hours budget.
    fixed_occupied = sum(_overlap_minutes(s, e, week_start, week_end) for s, e in fixed_rows if not is_all_day(s, e, tz))
    fixed_occupied += sum(
        _overlap_minutes(v.occurrence.start_at, v.occurrence.end_at, week_start, week_end)
        for v in virtual_occurrences(db, user, week_start, week_end)
    )

    # PlannedAllocation(W) — planned TimeBlocks overlapping W.
    planned_rows = db.execute(
        select(TimeBlock.start_at, TimeBlock.end_at)
        .join(Commitment, TimeBlock.commitment_id == Commitment.id)
        .where(
            Commitment.user_id == user.id,
            TimeBlock.status == "planned",
            TimeBlock.start_at < week_end,
            TimeBlock.end_at > week_start,
        )
    ).all()
    planned_allocation = sum(_overlap_minutes(s, e, week_start, week_end) for s, e in planned_rows)

    occupied = fixed_occupied + planned_allocation

    # DeadlinePressure(W) — sum of UnfulfilledDeadlineDemand for flexible
    # Commitments with due_at <= end of W (i.e. due this week or overdue).
    flexible_due_soon = list(
        db.execute(
            select(Commitment).where(
                Commitment.user_id == user.id,
                Commitment.mode == "flexible",
                Commitment.due_at.is_not(None),
                Commitment.due_at <= week_end,
            )
        ).scalars().all()
    )
    demands = [compute_commitment_demand(db, c) for c in flexible_due_soon]
    deadline_pressure = sum(d.unfulfilled_deadline_demand_minutes for d in demands)

    free_capacity = float(user.weekly_capacity_minutes) - occupied

    return WeekCapacitySnapshot(
        week_start=week_start,
        week_end=week_end,
        weekly_capacity_minutes=float(user.weekly_capacity_minutes),
        fixed_occupied_minutes=fixed_occupied,
        planned_allocation_minutes=planned_allocation,
        occupied_minutes=occupied,
        deadline_pressure_minutes=deadline_pressure,
        free_capacity_minutes=free_capacity,
        per_commitment_demand=demands,
    )
