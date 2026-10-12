"""
Password hashing and JWT issuing/verification. Deliberately unremarkable —
bcrypt (used directly, not through passlib — see note below) for hashing,
a signed HS256 JWT carrying just the user id and an expiry for auth. No
refresh tokens, no scopes, no roles in V1; Orbit is single-user-per-account
with nothing resembling permission tiers, so a short-lived access token is
all there is to build.

Why `bcrypt` directly and not `passlib`: passlib 1.7.4 (the latest
release) has a known incompatibility with bcrypt >=4.1's restructured
package metadata — it raises `password cannot be longer than 72 bytes`
even for a short password, because its own internal backend-detection
routine breaks first. Calling `bcrypt` directly sidesteps a dependency
that's effectively unmaintained against current bcrypt releases, at the
cost of one manual truncation (bcrypt has always had a real 72-byte input
limit; passlib silently handled it, so it's reproduced explicitly here).
"""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.core.config import settings

ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days — a student's app, not a bank
_BCRYPT_MAX_BYTES = 72


def hash_password(password: str) -> str:
    truncated = password.encode("utf-8")[:_BCRYPT_MAX_BYTES]
    return bcrypt.hashpw(truncated, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, password_hash: str) -> bool:
    truncated = plain_password.encode("utf-8")[:_BCRYPT_MAX_BYTES]
    return bcrypt.checkpw(truncated, password_hash.encode("utf-8"))


def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def decode_access_token(token: str) -> str | None:
    """Returns the user id (`sub`) if the token is valid, else None."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None
