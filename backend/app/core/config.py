from __future__ import annotations

from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_ignore_empty=True)

    database_url: str = "sqlite+aiosqlite:///./app.db"
    redis_url: str = "redis://localhost:6379/0"
    redis_enabled: bool = False
    secret_key: str = "change-me"
    access_token_expire_minutes: int | None = None
    upload_dir: str = str(BASE_DIR / "storage")
    cors_origins: list[str] = [
        "https://arg0n.ru",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    webhook_timeout_seconds: int = 5

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> list[str]:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        if isinstance(value, list):
            return [str(item) for item in value]
        return []


settings = Settings()
