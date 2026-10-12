from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
from app.models.user import User
from app.services.fin import seed_finance
from app.services.schedule import seed_planets


def register_user(db: Session, email: str, password: str, timezone: str) -> User:
    """
    Normalizes email to lowercase before persistence — the application-side
    half of the email-normalization invariant (Part 8 of the schema spec);
    `chk_email_lowercase` is the DB-side safety net for any write path that
    skips this function.
    """
    user = User(
        email=email.lower(),
        password_hash=hash_password(password),
        timezone=timezone,
    )
    db.add(user)
    try:
        db.flush()
        seed_planets(db, user.id)
        seed_finance(db, user)
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise ValueError("A user with this email already exists") from e
    db.refresh(user)
    return user


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    user = db.execute(select(User).where(User.email == email.lower())).scalar_one_or_none()
    if user is None:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user
