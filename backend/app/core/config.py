"""
Application settings, loaded from environment variables (or a local .env file
during development). Kept deliberately small: Orbit V1 has exactly one thing
that varies by environment — where the database is.
"""
from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/orbit_dev"
    environment: str = "development"
    # Deliberately an obviously-fake default rather than a real-looking one:
    # if you ever see this exact string outside local dev, .env isn't being
    # read. Set a real random value in .env before deploying anywhere.
    secret_key: str = "dev-only-insecure-secret-change-me"
    # Comma-separated browser origins allowed to call the API (the frontend's
    # URL). Vite's dev server by default; set to your Netlify URL in production.
    # The one email allowed to download tester feedback (GET /admin/feedback.csv). Empty = nobody.
    admin_email: str = ""
    # Turn off after you have made your own account so nobody else can register (ALLOW_SIGNUPS=false).
    allow_signups: bool = True
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @field_validator("database_url")
    @classmethod
    def _use_psycopg3_driver(cls, v: str) -> str:
        # Hosts (Neon, Render, Heroku-style) hand out `postgres://` or
        # `postgresql://` URLs; SQLAlchemy needs to be told to use psycopg 3.
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                return "postgresql+psycopg://" + v[len(prefix):]
        return v

    @model_validator(mode="after")
    def _refuse_default_secret_in_production(self) -> "Settings":
        if self.environment == "production" and self.secret_key == "dev-only-insecure-secret-change-me":
            raise ValueError("SECRET_KEY must be set to a real random value when ENVIRONMENT=production")
        return self


settings = Settings()
