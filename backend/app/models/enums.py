"""
Native PostgreSQL ENUM types, per Part I of the locked spec. Defined once
here and imported by every model that uses one, so the Python-side value
set and the DB-side value set can never drift apart silently.
"""
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

commitment_mode_enum = PGEnum(
    "fixed", "flexible",
    name="commitment_mode",
    create_type=False,  # created explicitly in the migration, before any table needs it
)

commitment_status_enum = PGEnum(
    "todo", "in_progress", "completed", "skipped", "archived",
    name="commitment_status",
    create_type=False,
)

commitment_category_enum = PGEnum(
    "study", "work", "personal", "other",
    name="commitment_category",
    create_type=False,
)

time_block_status_enum = PGEnum(
    "planned", "completed", "skipped",
    name="time_block_status",
    create_type=False,
)
