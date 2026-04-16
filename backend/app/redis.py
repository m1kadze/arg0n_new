from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

try:
    from redis.asyncio import Redis
except Exception:  # pragma: no cover - optional dependency
    Redis = Any  # type: ignore[assignment,misc]

from app.core.config import settings

PRESENCE_TTL_SECONDS = 60
INBOX_LIMIT = 100

_memory_presence: dict[int, dict[str, datetime]] = {}
_memory_inbox: dict[int, list[str]] = {}


def get_redis_client() -> Redis:
    return Redis.from_url(settings.redis_url, decode_responses=True)


async def get_redis() -> Redis | None:
    if not settings.redis_enabled:
        yield None
        return

    client = get_redis_client()
    try:
        await client.ping()
    except Exception:
        await client.close()
        yield None
        return

    try:
        yield client
    finally:
        await client.close()


async def get_redis_instance() -> Redis | None:
    """Non-generator helper for use outside of FastAPI Depends."""
    if not settings.redis_enabled:
        return None
    client = get_redis_client()
    try:
        await client.ping()
        return client
    except Exception:
        await client.close()
        return None


def _online_key(user_id: int) -> str:
    return f"presence:online:{user_id}"


def _last_active_key(user_id: int) -> str:
    return f"presence:last_active:{user_id}"


async def set_user_online(redis: Redis | None, user_id: int) -> None:
    now = datetime.now(timezone.utc).isoformat()
    if redis is None:
        _memory_presence[user_id] = {
            "online_until": datetime.now(timezone.utc)
            + timedelta(seconds=PRESENCE_TTL_SECONDS),
            "last_active": datetime.now(timezone.utc),
        }
        return

    await redis.set(_online_key(user_id), now, ex=PRESENCE_TTL_SECONDS)
    await redis.set(_last_active_key(user_id), now, ex=PRESENCE_TTL_SECONDS * 5)


async def set_user_offline(redis: Redis | None, user_id: int) -> None:
    if redis is None:
        entry = _memory_presence.get(user_id)
        if entry:
            entry["online_until"] = datetime.now(timezone.utc) - timedelta(seconds=1)
            entry["last_active"] = datetime.now(timezone.utc)
        return

    await redis.delete(_online_key(user_id))


async def is_user_online(redis: Redis | None, user_id: int) -> bool:
    if redis is None:
        entry = _memory_presence.get(user_id)
        if not entry:
            return False
        return entry["online_until"] >= datetime.now(timezone.utc)

    return await redis.exists(_online_key(user_id)) == 1


async def get_last_active(redis: Redis | None, user_id: int) -> datetime | None:
    if redis is None:
        entry = _memory_presence.get(user_id)
        if not entry:
            return None
        return entry.get("last_active")

    value = await redis.get(_last_active_key(user_id))
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


async def push_inbox_event(
    redis: Redis | None, user_id: int, payload_json: str
) -> None:
    if redis is None:
        queue = _memory_inbox.setdefault(user_id, [])
        queue.append(payload_json)
        if len(queue) > INBOX_LIMIT:
            del queue[:-INBOX_LIMIT]
        return

    key = f"events:inbox:{user_id}"
    await redis.rpush(key, payload_json)
    await redis.ltrim(key, -INBOX_LIMIT, -1)


async def pop_inbox_events(redis: Redis | None, user_id: int) -> list[str]:
    if redis is None:
        items = _memory_inbox.get(user_id, [])
        _memory_inbox[user_id] = []
        return items

    key = f"events:inbox:{user_id}"
    raw_items = await redis.lrange(key, 0, -1)
    if raw_items:
        await redis.delete(key)
    return list(raw_items)
