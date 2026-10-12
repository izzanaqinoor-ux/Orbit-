"""
Pure decision-support logic for the personal finance section. No database, no I/O.

Principle: every threshold here comes from the user's own rule set (config) — nothing is
invented. When a value is missing the function says so instead of guessing.
All money is integer cents; percentages are fractions (0.6 == 60%) unless named *_pp (percentage points).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date

# ── money ──

def money(cents: int, cur: str = "SGD") -> str:
    sym = "S$" if cur == "SGD" else cur + " "
    a = abs(int(round(cents)))
    body = f"{a // 100:,}" if a % 100 == 0 else f"{a / 100:,.2f}"
    return f"{'-' if cents < 0 else ''}{sym}{body}"


# ── default rule set (what a new user starts with — all editable) ──

def default_rules() -> dict:
    """Numbers here are the ones the user stated. Anything they did not state is 0/None and shown as 'not set'."""
    return {
        "spending_cap_cents": 30000,
        "liquidity_floor_cents": 30000,
        "liquidity_comfort_cents": 50000,
        "min_contribution_cents": 10000,
        "save_invest_target": {"low_cents": 25000, "high_cents": 40000},
        "tolerance_pp": 5,
        "allocation": [
            {"key": "spending", "label": "Spending", "pct": 0, "source": "spending"},
            {"key": "emergency", "label": "Emergency cash", "pct": 0, "source": "pocket", "purpose": "emergency"},
            {"key": "travel", "label": "Travel fund", "pct": 0, "source": "pocket", "purpose": "travel"},
            {"key": "general", "label": "General savings", "pct": 0, "source": "pocket", "purpose": "general"},
            {"key": "investments", "label": "Investments", "pct": 0, "source": "investment"},
            {"key": "other", "label": "Other goals", "pct": 0, "source": "pocket", "purpose": "other"},
        ],
        "portfolio": [{"ticker": "SPUS", "pct": 60}, {"ticker": "G3B", "pct": 25}, {"ticker": "AAPL", "pct": 15}],
        "conditions": {"liquidity_first": True, "cap_warning": True, "underweight_first": True, "redirect_to": "emergency"},
    }


def historical_four_asset_rules() -> dict:
    r = default_rules()
    r["portfolio"] = [{"ticker": "SPUS", "pct": 50}, {"ticker": "AAPL", "pct": 20}, {"ticker": "G3B", "pct": 15}, {"ticker": "DBS", "pct": 15}]
    return r


ROADMAP = [  # (age, nw_low, nw_high|None, note) in dollars; the user's own targets, editable
    (19, 5000, None, "Investments S$1,500–2,500 · emergency cash S$1,500–2,000 · save/invest S$250–400/mo · no consumer debt"),
    (20, 8000, 12000, None), (21, 15000, 20000, None), (22, 20000, 30000, None),
    (24, 60000, 100000, None), (27, 200000, 300000, None),
    (30, 500000, 1000000, "Financial capacity target — a scenario, not a guarantee"),
]


# ── liquidity ──

def liquidity(liquid_cents: int, floor_cents: int, comfort_cents: int | None, cur: str = "SGD") -> dict:
    gap = liquid_cents - floor_cents
    if liquid_cents < floor_cents:
        status, priority = "below", "cash"
        msg = (f"Liquid cash ({money(liquid_cents, cur)}) is {money(-gap, cur)} below your minimum buffer of "
               f"{money(floor_cents, cur)}. Prioritise rebuilding cash before making additional investment contributions.")
    elif comfort_cents and liquid_cents < comfort_cents:
        status, priority = "ok", "invest"
        msg = f"Liquid cash is above your minimum buffer by {money(gap, cur)}, still short of your comfortable level of {money(comfort_cents, cur)}."
    else:
        status, priority = "healthy", "invest"
        msg = f"Liquid cash is healthy — {money(gap, cur)} above your minimum buffer. Normal investing can continue."
    return {"liquid_cents": liquid_cents, "floor_cents": floor_cents, "comfort_cents": comfort_cents, "gap_cents": gap,
            "status": status, "priority": priority, "message": msg}


# ── portfolio ──

def portfolio_rows(holdings: list[dict], targets: list[dict], tolerance_pp: float) -> dict:
    """holdings: [{ticker, value_cents, priced}] ; targets: [{ticker, pct}] (pct in 0..100)."""
    value = {h["ticker"]: int(h["value_cents"]) for h in holdings}
    priced = {h["ticker"]: bool(h.get("priced", True)) for h in holdings}
    tickers = [t["ticker"] for t in targets] + [h["ticker"] for h in holdings if h["ticker"] not in {t["ticker"] for t in targets}]
    tgt = {t["ticker"]: float(t["pct"]) for t in targets}
    total = sum(value.get(t, 0) for t in tickers)
    rows = []
    for t in tickers:
        cur_pct = (value.get(t, 0) / total * 100) if total > 0 else 0.0
        diff = cur_pct - tgt.get(t, 0.0)
        status = "at_target" if abs(diff) <= tolerance_pp else ("overweight" if diff > 0 else "underweight")
        if total == 0:
            status = "at_target" if tgt.get(t, 0) == 0 else "underweight"
        rows.append({"ticker": t, "target_pct": tgt.get(t, 0.0), "current_pct": round(cur_pct, 2), "diff_pp": round(diff, 2),
                     "status": status, "value_cents": value.get(t, 0), "priced": priced.get(t, True),
                     "in_targets": t in tgt})
    return {"total_cents": total, "rows": rows, "target_total_pct": sum(tgt.values()),
            "max_drift_pp": max((abs(r["diff_pp"]) for r in rows), default=0.0) if total > 0 else 0.0}


def suggest_contribution(rows: list[dict], total_cents: int, amount_cents: int) -> list[dict]:
    """
    Contribution-based rebalancing: send new money to what is below target. Never sells.
    Aim at the post-contribution target value; fill shortfalls first, then spread any remainder by target weight.
    """
    if amount_cents <= 0:
        return []
    targets = {r["ticker"]: r["target_pct"] / 100 for r in rows if r["target_pct"] > 0}
    if not targets:
        return []
    after = total_cents + amount_cents
    short = {t: max(0, int(round(after * w)) - next(r["value_cents"] for r in rows if r["ticker"] == t)) for t, w in targets.items()}
    need = sum(short.values())
    alloc = {t: 0 for t in targets}
    if need >= amount_cents:
        for t, s in short.items():
            alloc[t] = amount_cents * s // need
    else:
        alloc = dict(short)
        rest = amount_cents - need
        wsum = sum(targets.values())
        for t, w in targets.items():
            alloc[t] += int(rest * w / wsum)
    left = amount_cents - sum(alloc.values())          # rounding crumbs go to the biggest shortfall
    if left:
        top = max(short, key=lambda k: (short[k], targets[k]))
        alloc[top] += left
    return [{"ticker": t, "amount_cents": a} for t, a in sorted(alloc.items(), key=lambda kv: -kv[1]) if a > 0]


# ── allocation ──

def allocation_lines(lines: list[dict], income_cents: int, actual: dict[str, int], redirect: tuple[str, str] | None = None) -> dict:
    """
    lines: rule-set allocation [{key,label,pct}] ; actual: {key: cents this month}.
    redirect: (from_key, to_key) — when liquidity is below the floor, the investments share is steered to cash.
    """
    total_pct = round(sum(float(l["pct"]) for l in lines), 4)
    rows = []
    for l in lines:
        t = int(round(income_cents * float(l["pct"]) / 100))
        a = int(actual.get(l["key"], 0))
        rows.append({"key": l["key"], "label": l["label"], "target_pct": float(l["pct"]), "target_cents": t, "effective_target_cents": t,
                     "actual_cents": a, "actual_pct": round(a / income_cents * 100, 2) if income_cents > 0 else 0.0,
                     "diff_cents": a - t, "progress": round(a / t, 4) if t > 0 else None, "redirected": None})
    if redirect:
        src = next((r for r in rows if r["key"] == redirect[0]), None)
        dst = next((r for r in rows if r["key"] == redirect[1]), None)
        if src and dst and src["target_cents"] > 0:
            dst["effective_target_cents"] += src["target_cents"]
            dst["redirected"] = "in"
            src["effective_target_cents"] = 0
            src["redirected"] = "out"
    return {"total_pct": total_pct, "valid": abs(total_pct - 100) < 0.01, "unset": total_pct == 0, "rows": rows}


# ── goals ──

def months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month) + (1 if b.day > a.day else 0)


def goal_metrics(target: int, current: int, target_date: date | None, actual_monthly: int, planned_monthly: int | None, today: date) -> dict:
    remaining = max(0, target - current)
    out = {"target_cents": target, "current_cents": current, "remaining_cents": remaining,
           "progress": round(min(1.0, current / target), 4) if target > 0 else 0.0,
           "required_monthly_cents": None, "actual_monthly_cents": actual_monthly, "planned_monthly_cents": planned_monthly,
           "eta_months": None, "status": "no_deadline"}
    if actual_monthly > 0 and remaining > 0:
        out["eta_months"] = math.ceil(remaining / actual_monthly)
    if remaining == 0:
        out["status"] = "achieved"
        return out
    if target_date is None:
        return out
    left = months_between(today, target_date)
    if left <= 0:
        out["status"] = "overdue"
        out["required_monthly_cents"] = remaining
        return out
    req = math.ceil(remaining / left)
    out["required_monthly_cents"] = req
    out["status"] = "on_track" if actual_monthly >= req else "behind"
    return out


# ── milestones ──

def age_on(birth: date, today: date) -> int:
    return today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))


def milestone_status(net_worth: int, age: int, milestones: list[dict]) -> dict | None:
    """Compare with the most recent checkpoint reached (or the first one if younger). Never shaming: neutral wording."""
    if not milestones:
        return None
    ms = sorted(milestones, key=lambda m: m["age"])
    passed = [m for m in ms if m["age"] <= age]
    cp = passed[-1] if passed else ms[0]
    nxt = next((m for m in ms if m["age"] > age), None)
    lo, hi = cp["nw_low_cents"], cp.get("nw_high_cents")
    if hi is not None and net_worth > hi:
        status = "ahead"
    elif net_worth >= lo:
        status = "on_track"
    else:
        status = "behind"
    return {"age": age, "checkpoint": cp, "status": status, "gap_to_low_cents": net_worth - lo, "next": nxt,
            "progress_to_next": round(min(1.0, max(0.0, net_worth / nxt["nw_low_cents"])), 4) if nxt and nxt["nw_low_cents"] > 0 else None}


# ── scenarios (always assumptions) ──

def scenario_growth(start_cents: int, monthly_cents: int, annual_return_pct: float, years: int) -> dict:
    r = annual_return_pct / 100 / 12
    bal = float(start_cents)
    contributed = float(start_cents)
    series = [{"year": 0, "value_cents": int(bal), "contributed_cents": int(contributed)}]
    for m in range(1, years * 12 + 1):
        bal = bal * (1 + r) + monthly_cents
        contributed += monthly_cents
        if m % 12 == 0:
            series.append({"year": m // 12, "value_cents": int(round(bal)), "contributed_cents": int(contributed)})
    return {"series": series, "final_cents": int(round(bal)), "contributed_cents": int(contributed),
            "growth_cents": int(round(bal - contributed)), "label": "Assumption, not a forecast"}


def scenario_property(price_cents: int, down_pct: float, loan_rate_pct: float, tenure_years: int, current_savings_cents: int,
                      monthly_save_cents: int) -> dict:
    down = int(round(price_cents * down_pct / 100))
    loan = price_cents - down
    n = tenure_years * 12
    r = loan_rate_pct / 100 / 12
    pay = int(round(loan * r / (1 - (1 + r) ** -n))) if r > 0 and n > 0 else (loan // n if n else 0)
    gap = max(0, down - current_savings_cents)
    months = math.ceil(gap / monthly_save_cents) if monthly_save_cents > 0 and gap > 0 else (0 if gap == 0 else None)
    return {"down_payment_cents": down, "loan_cents": loan, "monthly_payment_cents": pay, "gap_to_down_cents": gap,
            "months_to_down": months, "label": "Scenario only — property affordability depends on rules and prices outside your control"}


# ── affordability (Planning) ──

def affordability(price: int, counts_toward_cap: bool, cap_cents: int, spent_toward_cap: int, liquid_cents: int, pays_from_liquid: bool,
                  floor_cents: int, income_month_cents: int, min_contribution_cents: int, earmarked: bool, cur: str = "SGD") -> dict:
    cap_left = cap_cents - spent_toward_cap
    liquid_after = liquid_cents - (price if pays_from_liquid else 0)
    facts, flags = [], []
    verdict = "fits"
    if earmarked:
        facts.append("This is paid from a fund you've set aside for it, so it doesn't touch your monthly cap or everyday cash.")
    if counts_toward_cap:
        if price > cap_left:
            verdict = "over_cap"
            flags.append(f"It would take you {money(price - max(cap_left, 0), cur)} over your {money(cap_cents, cur)} monthly cap ({money(max(cap_left, 0), cur)} left this month).")
        else:
            facts.append(f"It fits inside your cap: {money(cap_left - price, cur)} would remain of {money(cap_cents, cur)}.")
    if pays_from_liquid and liquid_after < floor_cents:
        verdict = "below_floor"
        flags.append(f"Paying from liquid cash would leave {money(liquid_after, cur)}, under your {money(floor_cents, cur)} minimum buffer.")
    elif pays_from_liquid:
        facts.append(f"Liquid cash after: {money(liquid_after, cur)} (buffer {money(floor_cents, cur)}).")
    pct = (price / income_month_cents) if income_month_cents > 0 else None
    if pct is not None:
        facts.append(f"That is {pct * 100:.1f}% of the income you've received this month ({money(income_month_cents, cur)}).")
    wait = None
    if verdict != "fits" and counts_toward_cap and cap_cents > 0:
        wait = "Next month's cap resets — buying then would keep this month within your own rule."
    return {"verdict": verdict, "flags": flags, "facts": facts, "cap_left_cents": cap_left, "liquid_after_cents": liquid_after,
            "pct_of_month_income": round(pct, 4) if pct is not None else None, "suggestion": wait}


# ── warnings ──

@dataclass
class Warn:
    code: str
    level: str  # info | warn
    text: str

    def asdict(self) -> dict:
        return {"code": self.code, "level": self.level, "text": self.text}


def build_warnings(*, cap_cents: int, spent_cents: int, cap_on: bool, liq: dict, drift_pp: float, tolerance_pp: float, portfolio_total: int,
                   goals: list[dict], rate_now: float | None, rate_prev: float | None, contrib_this: int, contrib_prev: int,
                   min_contribution: int, day_of_month: int, cur: str = "SGD") -> list[dict]:
    w: list[Warn] = []
    if cap_on and cap_cents > 0 and spent_cents > cap_cents:
        w.append(Warn("cap", "warn", f"Spending is {money(spent_cents - cap_cents, cur)} above your {money(cap_cents, cur)} cap this month."))
    if liq["status"] == "below":
        w.append(Warn("liquidity", "warn", liq["message"]))
    if portfolio_total > 0 and drift_pp > tolerance_pp * 2:
        w.append(Warn("allocation", "warn", f"Your portfolio is {drift_pp:.0f} percentage points from target on its biggest gap — direct new contributions to underweight holdings."))
    for g in goals:
        if g["status"] == "behind":
            w.append(Warn("goal", "info", f"“{g['title']}” needs {money(g['required_monthly_cents'], cur)}/month to hit its date; recent pace is {money(g['actual_monthly_cents'], cur)}."))
    if rate_now is not None and rate_prev is not None and rate_now < rate_prev - 0.05:
        w.append(Warn("rate", "info", f"Your savings rate dipped from {rate_prev * 100:.0f}% to {rate_now * 100:.0f}% month on month."))
    if contrib_prev == 0 and contrib_this == 0 and min_contribution > 0:
        w.append(Warn("skipped", "info", "No investment contribution recorded last month or so far this month."))
    elif contrib_this > 0 and contrib_this < min_contribution:
        w.append(Warn("below_min", "info", f"Contributions so far this month ({money(contrib_this, cur)}) are under your {money(min_contribution, cur)} minimum."))
    return [x.asdict() for x in w]
