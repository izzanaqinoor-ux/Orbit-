"""
Import every model here so that (1) `Base.metadata` has all thirteen tables
registered before Alembic or `Base.metadata.create_all` touches it, and
(2) string-based relationship() forward references (e.g. Mapped["Goal"])
can actually resolve at mapper-configuration time.
"""
from app.models.commitment import Commitment
from app.models.fin import (BalanceItem, Entry, FinCategory, FinGoal, Holding, IncomeSource, Milestone, Pocket, WishlistItem,
                            MonthClose, Valuation, ImportRow, ImportRule, RuleSet, Scenario, Snapshot)
from app.models.extensions import Assignment, CommitmentException, Exam, Shift
from app.models.schedule import Occasion, Planet, SchoolTerm
from app.models.time_block import TimeBlock
from app.models.note import Note
from app.models.user import Goal, Job, Module, User

__all__ = [
    "BalanceItem", "Entry", "FinCategory", "FinGoal", "Holding", "IncomeSource", "Milestone", "Pocket", "WishlistItem",
    "RuleSet", "Scenario", "Snapshot",
    "Planet", "Occasion", "MonthClose", "Valuation", "ImportRow", "ImportRule",
    "SchoolTerm", "Note",
    "User",
    "Goal",
    "Module",
    "Job",
    "Commitment",
    "TimeBlock",
    "Assignment",
    "Exam",
    "Shift",
    "CommitmentException",
]
