from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(subject: str, expires_minutes: int | None = None) -> str:
    ttl_minutes = (
        expires_minutes
        if expires_minutes is not None
        else settings.access_token_expire_minutes
    )
    to_encode: dict[str, Any] = {"sub": subject}
    if ttl_minutes and ttl_minutes > 0:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes)
        to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.secret_key, algorithm="HS256")


def decode_access_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.secret_key, algorithms=["HS256"])


def get_subject_from_token(token: str) -> str | None:
    try:
        payload = decode_access_token(token)
    except JWTError:
        return None
    subject = payload.get("sub")
    return str(subject) if subject is not None else None
