"""
The one shared helper every UPDATE code path calls to satisfy Part G-1 of
the locked spec: `updated_at` is application-maintained, not trigger-
maintained.

Why this is a function you call, not an ORM event listener that fires
automatically: an SQLAlchemy `before_flush` hook that re-stamps every dirty
object's `updated_at` would work, but it's the same tradeoff the spec
already rejected for the database layer, one level up — it's standing
machinery that fires on every write to save one call-site line, and it
means "what actually happens on UPDATE" is no longer visible at the call
site. The spec's own reasoning (Part A, "Fixed cannot have TimeBlocks";
Part G-1 itself) is consistent throughout: where the write path is always
application-mediated anyway, keep the logic in one explicit place in that
path rather than duplicating it into a second, implicit layer. A service
function that updates a Commitment already has to build its own field
changes — adding `touch_updated_at(obj)` alongside them is that same
one-line convention, just spelled out instead of hidden in an event hook.
"""
from datetime import datetime, timezone

from app.db.base import UpdatedAtMixin


def touch_updated_at(obj: UpdatedAtMixin) -> None:
    """Set obj.updated_at to now(). Call this in every UPDATE code path,
    after applying the actual field changes, before commit."""
    obj.updated_at = datetime.now(timezone.utc)
