from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_id
from app.db.session import get_db
from app.models.fin import (BalanceItem, Entry, FinCategory, FinGoal, Holding, IncomeSource, Milestone, Pocket, WishlistItem, RuleSet,
                            Scenario)
from app.models.user import User
from app.schemas import fin as s
from app.services import fin as svc
from app.services import fin_books as books
from app.services import fin_import as imp

router = APIRouter(prefix="/fin", tags=["finance"])
UID = Depends(get_current_user_id)
DB = Depends(get_db)


def _get(db, model, uid, id_, what="item"):
    row = db.execute(select(model).where(model.id == id_, model.user_id == uid)).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")
    return row


# ── settings ──
@router.get("/settings")
def get_settings(uid: str = UID, db: Session = DB):
    u = svc._user(db, uid)
    return {"birth_date": u.birth_date, "currency": u.currency, "valuation_day": u.valuation_day, "exam_focus_days": u.exam_focus_days}


@router.patch("/settings")
def patch_settings(body: s.SettingsIn, uid: str = UID, db: Session = DB):
    u = svc._user(db, uid)
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None or k == "birth_date":
            setattr(u, k, v)
    db.commit()
    return {"birth_date": u.birth_date, "currency": u.currency, "valuation_day": u.valuation_day, "exam_focus_days": u.exam_focus_days}


# ── dashboard / history / planning ──
@router.get("/dashboard")
def dashboard(month: str | None = Query(None), uid: str = UID, db: Session = DB):
    return svc.dashboard(db, uid, month)


@router.get("/networth")
def networth(uid: str = UID, db: Session = DB):
    return svc.networth_history(db, uid)


@router.post("/plan")
def plan(body: s.PlanReq, uid: str = UID, db: Session = DB):
    return svc.plan(db, uid, body)


# ── pockets ──
@router.get("/pockets")
def pockets(uid: str = UID, db: Session = DB):
    svc._user(db, uid)
    bal = svc.pocket_balances(db, uid)
    rows = db.execute(select(Pocket).where(Pocket.user_id == uid).order_by(Pocket.created_at)).scalars().all()
    return [{"id": p.id, "name": p.name, "role": p.role, "purpose": p.purpose, "provider": p.provider, "is_liquid": p.is_liquid,
             "opening_cents": p.opening_cents, "archived": p.archived, "balance_cents": bal.get(p.id, 0)} for p in rows]


@router.post("/pockets", status_code=201)
def add_pocket(body: s.PocketIn, uid: str = UID, db: Session = DB):
    p = svc.create_row(db, Pocket, uid, body.model_dump(), "You already have a pocket with that name.")
    return {"id": p.id}


@router.patch("/pockets/{pid}")
def patch_pocket(pid: str, body: s.PocketPatch, uid: str = UID, db: Session = DB):
    p = _get(db, Pocket, uid, pid, "Pocket")
    svc.patch_row(db, p, body.model_dump(exclude_unset=True), "You already have a pocket with that name.")
    return {"id": p.id}


@router.delete("/pockets/{pid}", status_code=204)
def del_pocket(pid: str, uid: str = UID, db: Session = DB) -> None:
    svc.delete_row(db, _get(db, Pocket, uid, pid, "Pocket"), "This pocket has history. Archive it instead.")


# ── categories ──
@router.get("/categories")
def categories(uid: str = UID, db: Session = DB):
    svc._user(db, uid)
    return [{"id": c.id, "name": c.name, "kind": c.kind, "counts_toward_cap": c.counts_toward_cap, "archived": c.archived}
            for c in db.execute(select(FinCategory).where(FinCategory.user_id == uid).order_by(FinCategory.kind.desc(), FinCategory.created_at)).scalars()]


@router.post("/categories", status_code=201)
def add_category(body: s.CategoryIn, uid: str = UID, db: Session = DB):
    data = body.model_dump()
    if data["kind"] == "income":
        data["counts_toward_cap"] = False
    c = svc.create_row(db, FinCategory, uid, data, "You already have a category with that name.")
    return {"id": c.id}


@router.patch("/categories/{cid}")
def patch_category(cid: str, body: s.CategoryPatch, uid: str = UID, db: Session = DB):
    c = _get(db, FinCategory, uid, cid, "Category")
    svc.patch_row(db, c, body.model_dump(exclude_unset=True), "You already have a category with that name.")
    return {"id": c.id}


@router.delete("/categories/{cid}", status_code=204)
def del_category(cid: str, uid: str = UID, db: Session = DB) -> None:
    svc.delete_row(db, _get(db, FinCategory, uid, cid, "Category"), "This category has entries. Archive it instead.")


# ── holdings ──
@router.get("/holdings")
def holdings(uid: str = UID, db: Session = DB):
    svc._user(db, uid)
    return svc.holding_positions(db, uid)


@router.post("/holdings", status_code=201)
def add_holding(body: s.HoldingIn, uid: str = UID, db: Session = DB):
    h = svc.create_row(db, Holding, uid, body.model_dump(), "You already track that ticker.")
    return {"id": h.id}


@router.patch("/holdings/{hid}")
def patch_holding(hid: str, body: s.HoldingPatch, uid: str = UID, db: Session = DB):
    h = _get(db, Holding, uid, hid, "Holding")
    data = body.model_dump(exclude_unset=True)
    if "price_cents" in data and "price_as_of" not in data:
        data["price_as_of"] = svc._today(svc._user(db, uid))
    svc.patch_row(db, h, data, "Conflict")
    return {"id": h.id}


@router.delete("/holdings/{hid}", status_code=204)
def del_holding(hid: str, uid: str = UID, db: Session = DB) -> None:
    svc.delete_row(db, _get(db, Holding, uid, hid, "Holding"), "This holding has history. Archive it instead.")


# ── entries ──
@router.get("/entries", response_model=list[s.EntryOut])
def entries(month: str | None = Query(None), uid: str = UID, db: Session = DB):
    return svc.list_entries(db, uid, month)


@router.post("/entries", response_model=s.EntryOut, status_code=201)
def add_entry(body: s.EntryIn, uid: str = UID, db: Session = DB):
    return svc.create_entry(db, uid, body)


@router.put("/entries/{eid}", response_model=s.EntryOut)
def edit_entry(eid: str, body: s.EntryIn, uid: str = UID, db: Session = DB):
    return svc.update_entry(db, uid, eid, body)


@router.delete("/entries/{eid}", status_code=204)
def del_entry(eid: str, uid: str = UID, db: Session = DB) -> None:
    svc.delete_entry(db, uid, eid)


# ── goals ──
@router.post("/goals", status_code=201)
def add_goal(body: s.GoalIn, uid: str = UID, db: Session = DB):
    svc._own(db, Pocket, uid, body.pocket_id, "pocket")
    g = svc.create_row(db, FinGoal, uid, body.model_dump(), "Could not create goal")
    return {"id": g.id}


@router.patch("/goals/{gid}")
def patch_goal(gid: str, body: s.GoalPatch, uid: str = UID, db: Session = DB):
    g = _get(db, FinGoal, uid, gid, "Goal")
    svc.patch_row(db, g, body.model_dump(exclude_unset=True), "Conflict")
    return {"id": g.id}


@router.delete("/goals/{gid}", status_code=204)
def del_goal(gid: str, uid: str = UID, db: Session = DB) -> None:
    svc.delete_row(db, _get(db, FinGoal, uid, gid, "Goal"), "Conflict")


# ── rules ──
@router.get("/rules", response_model=list[s.RuleSetOut])
def rules(uid: str = UID, db: Session = DB):
    svc._user(db, uid)
    return db.execute(select(RuleSet).where(RuleSet.user_id == uid).order_by(RuleSet.status, RuleSet.created_at.desc())).scalars().all()


@router.put("/rules/current", response_model=s.RuleSetOut)
def update_rules(body: s.RulesIn, uid: str = UID, db: Session = DB):
    """Editing rules never overwrites history: the old current rules become 'historical', a new current version is created."""
    old = svc.current_rules(db, uid)
    today = svc._today(svc._user(db, uid))
    new_cfg = body.config.model_dump()
    if new_cfg == old.config:
        return old
    old.status = "historical"
    old.effective_to = today
    db.flush()
    new = RuleSet(user_id=uid, name="Current rules", status="current", effective_from=today, config=new_cfg, note=body.note)
    db.add(new)
    db.commit()
    db.refresh(new)
    return new


# ── milestones ──
@router.get("/milestones", response_model=list[s.MilestoneOut])
def milestones(uid: str = UID, db: Session = DB):
    svc._user(db, uid)
    return db.execute(select(Milestone).where(Milestone.user_id == uid).order_by(Milestone.age)).scalars().all()


@router.put("/milestones/{age}", response_model=s.MilestoneOut)
def put_milestone(age: int, body: s.MilestoneIn, uid: str = UID, db: Session = DB):
    row = db.execute(select(Milestone).where(Milestone.user_id == uid, Milestone.age == age)).scalar_one_or_none()
    data = body.model_dump()
    data["age"] = age
    if row is None:
        row = svc.create_row(db, Milestone, uid, data, "Conflict")
    else:
        svc.patch_row(db, row, data, "Conflict")
    return row


@router.delete("/milestones/{age}", status_code=204)
def del_milestone(age: int, uid: str = UID, db: Session = DB) -> None:
    row = db.execute(select(Milestone).where(Milestone.user_id == uid, Milestone.age == age)).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Milestone not found")
    svc.delete_row(db, row, "Conflict")


# ── scenarios ──
def _scn_out(db, sc: Scenario, uid: str) -> dict:
    d = svc.dashboard(db, uid, None) if sc.kind == "property" else None
    defaults = {"total_cash_cents": d["total_cash_cents"], "invest_value_cents": d["portfolio"]["total_cents"]} if d else None
    return {"id": sc.id, "name": sc.name, "kind": sc.kind, "params": sc.params, "result": svc.run_scenario(sc.kind, sc.params, defaults), "created_at": sc.created_at}


@router.get("/scenarios", response_model=list[s.ScenarioOut])
def scenarios(uid: str = UID, db: Session = DB):
    svc._user(db, uid)
    return [_scn_out(db, x, uid) for x in db.execute(select(Scenario).where(Scenario.user_id == uid).order_by(Scenario.created_at)).scalars()]


@router.post("/scenarios", response_model=s.ScenarioOut, status_code=201)
def add_scenario(body: s.ScenarioIn, uid: str = UID, db: Session = DB):
    try:
        svc.run_scenario(body.kind, body.params)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"Those assumptions don't look right: {e}") from e
    sc = svc.create_row(db, Scenario, uid, body.model_dump(), "Conflict")
    return _scn_out(db, sc, uid)


@router.delete("/scenarios/{sid}", status_code=204)
def del_scenario(sid: str, uid: str = UID, db: Session = DB) -> None:
    svc.delete_row(db, _get(db, Scenario, uid, sid, "Scenario"), "Conflict")


# ── income sources / other balances ──
@router.get("/income-sources", response_model=list[s.IncomeSourceOut])
def income_sources(uid: str = UID, db: Session = DB):
    svc._user(db, uid)
    return db.execute(select(IncomeSource).where(IncomeSource.user_id == uid).order_by(IncomeSource.created_at)).scalars().all()


@router.post("/income-sources", response_model=s.IncomeSourceOut, status_code=201)
def add_income_source(body: s.IncomeSourceIn, uid: str = UID, db: Session = DB):
    return svc.create_row(db, IncomeSource, uid, body.model_dump(), "Conflict")


@router.put("/income-sources/{iid}", response_model=s.IncomeSourceOut)
def put_income_source(iid: str, body: s.IncomeSourceIn, uid: str = UID, db: Session = DB):
    return svc.patch_row(db, _get(db, IncomeSource, uid, iid, "Income source"), body.model_dump(), "Conflict")


@router.delete("/income-sources/{iid}", status_code=204)
def del_income_source(iid: str, uid: str = UID, db: Session = DB) -> None:
    svc.delete_row(db, _get(db, IncomeSource, uid, iid, "Income source"), "Conflict")


@router.get("/balances", response_model=list[s.BalanceOut])
def balances(uid: str = UID, db: Session = DB):
    svc._user(db, uid)
    return db.execute(select(BalanceItem).where(BalanceItem.user_id == uid).order_by(BalanceItem.created_at)).scalars().all()


@router.post("/balances", response_model=s.BalanceOut, status_code=201)
def add_balance(body: s.BalanceIn, uid: str = UID, db: Session = DB):
    return svc.create_row(db, BalanceItem, uid, body.model_dump(), "Conflict")


@router.put("/balances/{bid}", response_model=s.BalanceOut)
def put_balance(bid: str, body: s.BalanceIn, uid: str = UID, db: Session = DB):
    return svc.patch_row(db, _get(db, BalanceItem, uid, bid, "Item"), body.model_dump(), "Conflict")


@router.delete("/balances/{bid}", status_code=204)
def del_balance(bid: str, uid: str = UID, db: Session = DB) -> None:
    svc.delete_row(db, _get(db, BalanceItem, uid, bid, "Item"), "Conflict")


# ── wishlist ──
@router.get("/wishlist")
def wishlist(uid: str = UID, db: Session = DB):
    return svc.list_wishlist(db, uid)


@router.post("/wishlist", status_code=201)
def add_wish(body: s.WishIn, uid: str = UID, db: Session = DB):
    svc._own(db, FinCategory, uid, body.category_id, "category")
    w = svc.create_row(db, WishlistItem, uid, body.model_dump(), "Could not add that to your wishlist.")
    return {"id": w.id}


@router.patch("/wishlist/{wid}")
def patch_wish(wid: str, body: s.WishPatch, uid: str = UID, db: Session = DB):
    w = _get(db, WishlistItem, uid, wid, "Wishlist item")
    svc.patch_row(db, w, body.model_dump(exclude_unset=True), "Conflict")
    return {"id": w.id}


@router.delete("/wishlist/{wid}", status_code=204)
def del_wish(wid: str, uid: str = UID, db: Session = DB) -> None:
    svc.delete_row(db, _get(db, WishlistItem, uid, wid, "Wishlist item"), "Conflict")


# ── statement / reconciliation ──
@router.get("/statement")
def statement(month: str | None = Query(None), uid: str = UID, db: Session = DB):
    return books.statement(db, uid, month)


@router.post("/statement/{month}/settle")
def settle(month: str, body: s.SettleIn, uid: str = UID, db: Session = DB):
    return books.settle(db, uid, month, body.items)


@router.delete("/statement/{month}/pockets/{pid}")
def undo_settle(month: str, pid: str, uid: str = UID, db: Session = DB):
    return books.undo_settle(db, uid, month, pid)


# ── weekly summary ──
@router.get("/week")
def week(start: date | None = Query(None), uid: str = UID, db: Session = DB):
    return books.week_summary(db, uid, start)


# ── monthly investment check-in ──
@router.get("/valuations")
def valuations(uid: str = UID, db: Session = DB):
    return books.valuations(db, uid)


@router.put("/valuations")
def put_valuations(body: s.ValuesIn, uid: str = UID, db: Session = DB):
    return books.record_valuations(db, uid, body.month, body.values)


# ── bank statement import ──
@router.post("/import/preview")
def import_preview(body: s.ImportPreviewIn, uid: str = UID, db: Session = DB):
    return imp.preview(db, uid, body.rows)


@router.post("/import/commit")
def import_commit(body: s.ImportCommitIn, uid: str = UID, db: Session = DB):
    return imp.commit(db, uid, body.rows)


@router.get("/import/summary")
def import_summary(uid: str = UID, db: Session = DB):
    return imp.summary(db, uid)
