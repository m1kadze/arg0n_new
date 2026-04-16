from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request

from app.deps import get_current_user
from app.models import User
from app.redis import get_redis, pop_inbox_events, push_inbox_event

router = APIRouter(prefix="/hooks", tags=["hooks"])


@router.post("/inbox/{user_id}")
async def receive_inbox(user_id: int, request: Request, redis=Depends(get_redis)) -> dict:
    body = await request.body()
    try:
        payload = json.loads(body.decode("utf-8")) if body else {}
    except json.JSONDecodeError:
        payload = {"raw": body.decode("utf-8", errors="ignore")}

    payload_json = json.dumps(payload, separators=(",", ":"), ensure_ascii=True)
    await push_inbox_event(redis, user_id, payload_json)
    return {"status": "ok"}


@router.get("/inbox")
async def read_inbox(
    current_user: User = Depends(get_current_user),
    redis=Depends(get_redis),
) -> list[dict]:
    raw_items = await pop_inbox_events(redis, current_user.id)

    items: list[dict] = []
    for raw in raw_items:
        try:
            items.append(json.loads(raw))
        except json.JSONDecodeError:
            items.append({"raw": raw})
    return items
