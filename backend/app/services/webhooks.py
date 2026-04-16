from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import Webhook


def events_to_string(events: list[str]) -> str:
    cleaned = [event.strip() for event in events if event.strip()]
    return ",".join(cleaned)


def parse_events(events: str) -> set[str]:
    if not events:
        return set()
    return {event.strip() for event in events.split(",") if event.strip()}


async def dispatch_webhooks(
    session: AsyncSession, event: str, payload: dict, user_ids: list[int]
) -> None:
    if not user_ids:
        return

    result = await session.execute(
        select(Webhook).where(Webhook.user_id.in_(user_ids), Webhook.enabled.is_(True))
    )
    hooks = result.scalars().all()
    if not hooks:
        return

    base_payload = {
        "event": event,
        "data": payload,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    body = json.dumps(base_payload, separators=(",", ":"), ensure_ascii=True)

    async with httpx.AsyncClient() as client:
        tasks = []
        for hook in hooks:
            allowed = parse_events(hook.events)
            if allowed and event not in allowed:
                continue

            headers = {"Content-Type": "application/json"}
            if hook.secret:
                signature = hmac.new(
                    hook.secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256
                ).hexdigest()
                headers["X-Webhook-Signature"] = signature

            tasks.append(
                client.post(
                    hook.url,
                    content=body,
                    headers=headers,
                    timeout=settings.webhook_timeout_seconds,
                )
            )

        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for result in results:
                if isinstance(result, Exception):
                    # Best-effort delivery; avoid raising inside request paths.
                    pass