from datetime import date, datetime, timezone

import pytest

from app.services.recurrence import InvalidRecurrenceRule, expand, validate_rule

UTC = timezone.utc


def _dt(*a):
    return datetime(*a, tzinfo=UTC)


def test_weekly_basic_singapore():
    # Mon 2026-09-21 09:00-11:00 SGT == 01:00-03:00 UTC, repeats Mon+Wed
    occ = expand(
        {"freq": "weekly", "days": ["MON", "WED"]},
        _dt(2026, 9, 21, 1), _dt(2026, 9, 21, 3), "Asia/Singapore",
        _dt(2026, 9, 20), _dt(2026, 10, 5),
    )
    assert [o.occurrence_date for o in occ] == [
        date(2026, 9, 21), date(2026, 9, 23), date(2026, 9, 28), date(2026, 9, 30),
    ]
    assert occ[0].start_at == _dt(2026, 9, 21, 1)
    assert (occ[0].end_at - occ[0].start_at).total_seconds() == 7200


def test_interval_two_weeks():
    occ = expand(
        {"freq": "weekly", "interval": 2, "days": ["MON"]},
        _dt(2026, 9, 21, 1), _dt(2026, 9, 21, 3), "Asia/Singapore",
        _dt(2026, 9, 20), _dt(2026, 10, 20),
    )
    assert [o.occurrence_date for o in occ] == [date(2026, 9, 21), date(2026, 10, 5), date(2026, 10, 19)]


def test_no_occurrences_before_anchor_even_in_anchor_week():
    # Template starts Wed 23 Sep; MON of that same week must NOT generate.
    occ = expand(
        {"freq": "weekly", "days": ["MON", "WED"]},
        _dt(2026, 9, 23, 1), _dt(2026, 9, 23, 3), "Asia/Singapore",
        _dt(2026, 9, 20), _dt(2026, 9, 27),
    )
    assert [o.occurrence_date for o in occ] == [date(2026, 9, 23)]


def test_recurrence_end_date_inclusive():
    occ = expand(
        {"freq": "weekly", "days": ["MON"]},
        _dt(2026, 9, 21, 1), _dt(2026, 9, 21, 3), "Asia/Singapore",
        _dt(2026, 9, 20), _dt(2026, 12, 1), recurrence_end_date=date(2026, 10, 5),
    )
    assert [o.occurrence_date for o in occ] == [date(2026, 9, 21), date(2026, 9, 28), date(2026, 10, 5)]


def test_dst_wall_clock_preserved_new_york():
    # Mon 2 Mar 2026 09:00 EST (UTC-5) = 14:00 UTC. DST starts Sun 8 Mar.
    occ = expand(
        {"freq": "weekly", "days": ["MON"]},
        _dt(2026, 3, 2, 14), _dt(2026, 3, 2, 15), "America/New_York",
        _dt(2026, 3, 1), _dt(2026, 3, 20),
    )
    assert occ[0].start_at == _dt(2026, 3, 2, 14)      # EST
    assert occ[1].start_at == _dt(2026, 3, 9, 13)      # EDT: same 9am wall clock, new UTC instant
    assert occ[2].start_at == _dt(2026, 3, 16, 13)


def test_window_overlap_only():
    occ = expand(
        {"freq": "weekly", "days": ["MON"]},
        _dt(2026, 9, 21, 1), _dt(2026, 9, 21, 3), "Asia/Singapore",
        _dt(2026, 9, 28, 2), _dt(2026, 9, 28, 2, 30),  # window sits inside the 28th occurrence
    )
    assert [o.occurrence_date for o in occ] == [date(2026, 9, 28)]


@pytest.mark.parametrize("bad", [
    {"freq": "daily", "days": ["MON"]},
    {"freq": "weekly", "days": []},
    {"freq": "weekly", "days": ["FUNDAY"]},
    {"freq": "weekly", "interval": 0, "days": ["MON"]},
    {"freq": "weekly", "days": ["MON"], "time": "09:00"},
    {"freq": "weekly", "days": ["MON", "MON"]},
    "weekly",
])
def test_invalid_rules_rejected(bad):
    with pytest.raises(InvalidRecurrenceRule):
        validate_rule(bad)
