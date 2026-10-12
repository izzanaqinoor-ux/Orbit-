"""
UUIDv7 generation — application-side, per Part H of the locked schema spec.

Why this file exists at all: the spec is explicit that no PostgreSQL-side
default (gen_random_uuid() or otherwise) is ever assumed for a primary key,
specifically to avoid silently falling back to UUIDv4. That means every
model's `id` column needs a Python-side default that actually produces a
v7 UUID — this is the one function that default points to, everywhere.

Centralizing it here (rather than importing `uuid6` directly in every model
file) also means if the ID strategy ever needs to change, there is exactly
one place to change it.
"""
from uuid6 import uuid7


def generate_uuid7() -> str:
    """Return a new UUIDv7 as a string. Models pass this as `default=`."""
    return str(uuid7())
