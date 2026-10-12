# Orbit finance v3: architecture & decisions

Flow: EARN → BUDGET → PROTECT LIQUIDITY → SAVE → INVEST → TRACK → INCREASE INCOME → BUILD WEALTH.

## Principles
- Money is integer cents. Derived numbers (balances, net worth, rates, progress) are computed on read, never stored. Only month snapshots are stored (for history).
- Investments are not expenses. Spending cap (default S$300) is a ceiling, not a target.
- Every rule is configurable and versioned. Editing rules archives the old set as *historical*; only the *current* set drives advice.
- Projections and scenarios are labelled assumptions, never guarantees. Property is a scenario only.
- No app auto-labels anything halal/haram. Holdings carry your own screening note; purification is an expense category you record.

## Assumptions (change in the UI)
- Allocation percentages start unset (0) because no split was specified.
- Liquidity floor S$300, comfort S$500. Minimum investment S$100/month (a floor). Save+invest target S$250–400.
- Portfolio target SPUS 60 / G3B 25 / AAPL 15, drift tolerance 5 points. Old four-asset framework kept as history.
- Car licence fund: earmarked, S$2,500, not liquid, outside the cap. Travel fund: liquid.
- Month = calendar month. Prices are entered manually. Recurring (template) shifts count toward expected pay.
- Savings delta counts flows between non-savings and savings pockets only.
- Rebalancing is by contribution; Orbit never suggests selling.

## Data
Tables: fin_pockets, fin_categories, fin_holdings, fin_entries (income/expense/transfer/contribution/dividend, shape enforced by CHECK), fin_goals, fin_rule_sets, fin_milestones, fin_scenarios, fin_income_sources, fin_balance_items, fin_snapshots.

## Changes after first review
- Wishlist (`fin_wishlist`): a not-recommended purchase can be saved and is re-checked against current rules on every read.
- Entries can be edited (`PUT /fin/entries/{id}`, same validation as create). Categories can be removed (archived: hidden from new entries, history intact).
- No default "Purification / charity" category. Calendar terms/breaks are generic "busy periods" / "time off".

## Statement, check-ins, week
- Monthly statement = a double-entry journal built from entries (Dr/Cr always equal). Reconciliation compares the books with what you actually have per pocket.
  Surplus: booked as income "Unrecorded cash" and optionally moved to a pocket (suggested: the cash-first redirect pocket if liquidity is under the floor, else a pocket whose goal is behind, else General savings).
  Shortfall: booked as "Unrecorded spending" outside the cap, and next month's cap is reduced by the same amount (never counted twice). Undo removes the created entries.
- Monthly investment check-in: you enter each holding's value on your chosen day (1-28). Monthly return uses modified Dietz (new contributions removed); this is bookkeeping, not a buy/sell signal. Entering a value also refreshes the holding's price when units are known.
- Occasions (`occasions`): rare dates, optionally yearly. This-week money card: hours, expected/earned pay, logged income, spending vs a weekly share of the cap.
