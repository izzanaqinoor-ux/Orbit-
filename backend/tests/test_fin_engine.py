from datetime import date

from app.services import fin_engine as f


def test_liquidity_states():
    assert f.liquidity(20000, 30000, 50000)["priority"] == "cash"
    assert f.liquidity(20000, 30000, 50000)["status"] == "below"
    assert f.liquidity(40000, 30000, 50000)["status"] == "ok"
    assert f.liquidity(60000, 30000, 50000)["status"] == "healthy"
    assert "below your minimum buffer" in f.liquidity(0, 30000, None)["message"]


def _rows(values):
    return f.portfolio_rows([{"ticker": k, "value_cents": v} for k, v in values.items()],
                            [{"ticker": "SPUS", "pct": 60}, {"ticker": "G3B", "pct": 25}, {"ticker": "AAPL", "pct": 15}], 5)


def test_portfolio_status():
    p = _rows({"SPUS": 2000, "G3B": 3500, "AAPL": 4500})
    st = {r["ticker"]: r["status"] for r in p["rows"]}
    assert st == {"SPUS": "underweight", "G3B": "overweight", "AAPL": "overweight"}
    assert _rows({"SPUS": 6000, "G3B": 2500, "AAPL": 1500})["max_drift_pp"] == 0
    assert all(r["status"] == "underweight" for r in _rows({"SPUS": 0, "G3B": 0, "AAPL": 0})["rows"])


def test_contribution_goes_to_underweight_and_sums():
    p = _rows({"SPUS": 2000, "G3B": 3500, "AAPL": 4500})
    s = f.suggest_contribution(p["rows"], p["total_cents"], 10000)
    assert sum(x["amount_cents"] for x in s) == 10000
    assert s[0]["ticker"] == "SPUS"
    assert all(x["ticker"] != "AAPL" for x in s)   # overweight gets nothing while others are short


def test_contribution_when_all_on_target_follows_weights():
    p = _rows({"SPUS": 6000, "G3B": 2500, "AAPL": 1500})
    s = {x["ticker"]: x["amount_cents"] for x in f.suggest_contribution(p["rows"], p["total_cents"], 10000)}
    assert s == {"SPUS": 6000, "G3B": 2500, "AAPL": 1500}


def test_allocation_redirect():
    lines = [{"key": "spending", "label": "S", "pct": 30}, {"key": "emergency", "label": "E", "pct": 20}, {"key": "investments", "label": "I", "pct": 50}]
    a = f.allocation_lines(lines, 100000, {"investments": 10000}, redirect=("investments", "emergency"))
    r = {x["key"]: x for x in a["rows"]}
    assert a["valid"] and r["investments"]["effective_target_cents"] == 0 and r["emergency"]["effective_target_cents"] == 70000
    assert f.allocation_lines(lines[:2], 1000, {})["valid"] is False
    assert f.allocation_lines([{"key": "a", "label": "a", "pct": 0}], 1000, {})["unset"]


def test_goal_status():
    today = date(2026, 10, 6)
    g = f.goal_metrics(100000, 40000, date(2027, 4, 6), 5000, None, today)
    assert g["required_monthly_cents"] == 10000 and g["status"] == "behind"
    assert f.goal_metrics(100000, 40000, date(2027, 4, 6), 10000, None, today)["status"] == "on_track"
    assert f.goal_metrics(100, 100, None, 0, None, today)["status"] == "achieved"
    assert f.goal_metrics(100, 10, None, 0, None, today)["status"] == "no_deadline"


def test_milestones_neutral_statuses():
    ms = [{"age": 19, "nw_low_cents": 500000, "nw_high_cents": None}, {"age": 20, "nw_low_cents": 800000, "nw_high_cents": 1200000}]
    assert f.milestone_status(900000, 20, ms)["status"] == "on_track"
    assert f.milestone_status(1300000, 20, ms)["status"] == "ahead"
    assert f.milestone_status(100, 20, ms)["status"] == "behind"
    assert f.milestone_status(600000, 18, ms)["checkpoint"]["age"] == 19   # younger than first → first
    assert f.age_on(date(2007, 10, 7), date(2026, 10, 6)) == 18


def test_scenarios():
    g = f.scenario_growth(0, 10000, 0, 1)
    assert g["final_cents"] == 120000 and g["growth_cents"] == 0
    assert f.scenario_growth(0, 10000, 6, 10)["final_cents"] > 1200000 * 1
    p = f.scenario_property(50000000, 25, 3, 25, 1000000, 100000)
    assert p["down_payment_cents"] == 12500000 and p["months_to_down"] == 115


def test_affordability_rules():
    a = f.affordability(8000, True, 30000, 25000, 100000, True, 30000, 90000, 10000, False)
    assert a["verdict"] == "over_cap"
    b = f.affordability(8000, True, 30000, 0, 36000, True, 30000, 90000, 10000, False)
    assert b["verdict"] == "below_floor"
    c = f.affordability(8000, True, 30000, 0, 100000, True, 30000, 90000, 10000, False)
    assert c["verdict"] == "fits" and c["pct_of_month_income"] == round(8000 / 90000, 4)
    d = f.affordability(100000, False, 30000, 30000, 250000, False, 30000, 0, 10000, True)
    assert d["verdict"] == "fits"


def test_warnings():
    liq = f.liquidity(10000, 30000, None)
    w = f.build_warnings(cap_cents=30000, spent_cents=35000, cap_on=True, liq=liq, drift_pp=0, tolerance_pp=5, portfolio_total=0, goals=[],
                         rate_now=0.1, rate_prev=0.3, contrib_this=0, contrib_prev=0, min_contribution=10000, day_of_month=10)
    assert {x["code"] for x in w} == {"cap", "liquidity", "rate", "skipped"}
