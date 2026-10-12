"""
Recurrence engine — the Part D `recurrence_rule` contract, implemented.

Contract (locked in the schema spec):
  {"freq": "weekly", "interval": 1, "days": ["MON", "WED"]}
- weekly only; `interval` = every Nth week (default 1), counted from the
  template's own first week; `days` = at least one weekday code.
- NO time-of-day in the rule. Time-of-day and duration come from the
  template Commitment's own start_at/end_at, read in the user's IANA
  timezone. The wall-clock time is what repeats, so DST transitions are
  correct automatically (9am stays 9am local, the UTC instant shifts).

This module is pure (no DB access) so the hard part — date/DST maths — is
unit-testable on its own. The DB-touching glue lives in
`recurrence_service.py`.
"""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo

_DAY_CODES = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4, "SAT": 5, "SUN": 6}


class InvalidRecurrenceRule(ValueError):
    pass


def validate_rule(rule: dict) -> None:
    """Enforces the minimum V1 contract; anything outside it is rejected up
    front rather than silently ignored (a rule that 'works' but means
    something other than what the user typed is worse than an error)."""
    if not isinstance(rule, dict):
        raise InvalidRecurrenceRule("recurrence_rule must be an object")
    unknown = set(rule) - {"freq", "interval", "days"}
    if unknown:
        raise InvalidRecurrenceRule(
            f"Unsupported recurrence_rule keys: {sorted(unknown)} "
            f"(V1 supports only freq, interval, days — no time-of-day, no monthly/yearly)"
        )
    if rule.get("freq") != "weekly":
        raise InvalidRecurrenceRule("Only freq='weekly' is supported in V1")
    interval = rule.get("interval", 1)
    if not isinstance(interval, int) or isinstance(interval, bool) or interval < 1:
        raise InvalidRecurrenceRule("interval must be an integer >= 1")
    days = rule.get("days")
    if not isinstance(days, list) or not days:
        raise InvalidRecurrenceRule("days must be a non-empty list of MON..SUN")
    bad = [d for d in days if d not in _DAY_CODES]
    if bad:
        raise InvalidRecurrenceRule(f"Unknown day codes: {bad}; use MON, TUE, WED, THU, FRI, SAT, SUN")
    if len(set(days)) != len(days):
        raise InvalidRecurrenceRule("days contains duplicates")


@dataclass(frozen=True)
class Occurrence:
    occurrence_date: date      # the user-local calendar date the occurrence starts on
    start_at: datetime         # tz-aware UTC
    end_at: datetime           # tz-aware UTC


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def expand(
    rule: dict,
    template_start: datetime,
    template_end: datetime,
    tz_name: str,
    window_start: datetime,
    window_end: datetime,
    recurrence_end_date: date | None = None,
) -> list[Occurrence]:
    """
    All occurrences whose [start, end) overlaps [window_start, window_end),
    in chronological order. Exceptions and already-materialized dates are
    NOT filtered here — that's the caller's job, because it needs the DB.
    """
    validate_rule(rule)
    tz = ZoneInfo(tz_name)
    interval = rule.get("interval", 1)
    wanted = {_DAY_CODES[d] for d in rule["days"]}

    local_start = template_start.astimezone(tz)
    anchor_date = local_start.date()
    anchor_monday = _monday(anchor_date)
    start_time = local_start.timetz().replace(tzinfo=None)
    duration = template_end - template_start  # absolute, fixed at pattern level

    # Candidate local dates: pad by a day each side so an occurrence that
    # starts the evening before the window (or spans midnight) is caught.
    first = (window_start.astimezone(tz).date() - timedelta(days=1))
    last = (window_end.astimezone(tz).date() + timedelta(days=1))
    d = max(first, anchor_date)

    out: list[Occurrence] = []
    while d <= last:
        if recurrence_end_date is not None and d > recurrence_end_date:
            break
        if d.weekday() in wanted and ((_monday(d) - anchor_monday).days // 7) % interval == 0:
            # Re-project the wall-clock time onto this date, in the user's zone.
            start_utc = datetime.combine(d, start_time, tzinfo=tz).astimezone(dt_timezone.utc)
            end_utc = start_utc + duration
            if start_utc < window_end and end_utc > window_start:
                out.append(Occurrence(d, start_utc, end_utc))
        d += timedelta(days=1)
    return out
