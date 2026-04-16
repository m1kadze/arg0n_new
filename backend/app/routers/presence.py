from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_current_user
from app.models import User
from app.redis import get_redis, is_user_online, set_user_offline, set_user_online
from app.schemas import PresenceOut
from app.services.chat_utils import get_chat_partner_ids
from app.services.webhooks import dispatch_webhooks
from app.routers.ws_events import broadcast_to_users

router = APIRouter(prefix="/presence", tags=["presence"])


@router.get("/{user_id}", response_model=PresenceOut)
async def get_presence(
    user_id: int,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
) -> PresenceOut:
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    is_online = await is_user_online(redis, user_id)
    return PresenceOut(user_id=user_id, is_online=is_online, last_seen_at=user.last_seen_at)


@router.post("/ping", response_model=PresenceOut)
async def ping(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    redis=Depends(get_redis),
) -> PresenceOut:
    was_online = await is_user_online(redis, current_user.id)
    await set_user_online(redis, current_user.id)

    current_user.last_seen_at = datetime.now(timezone.utc)
    session.add(current_user)
    await session.commit()

    if not was_online:
        partner_ids = await get_chat_partner_ids(session, current_user.id)
        presence_payload = {"user_id": current_user.id, "is_online": True}
        await dispatch_webhooks(
            session,
            event="presence.update",
            payload=presence_payload,
            user_ids=partner_ids,
        )
        await broadcast_to_users(
            partner_ids,
            {"event": "presence.update", "data": presence_payload, "timestamp": datetime.now(timezone.utc).isoformat()},
            exclude_user_id=current_user.id,
        )

    return PresenceOut(
        user_id=current_user.id,
        is_online=True,
        last_seen_at=current_user.last_seen_at,
    )


@router.post("/offline", response_model=PresenceOut)
async def offline(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    redis=Depends(get_redis),
) -> PresenceOut:
    was_online = await is_user_online(redis, current_user.id)
    await set_user_offline(redis, current_user.id)

    current_user.last_seen_at = datetime.now(timezone.utc)
    session.add(current_user)
    await session.commit()

    if was_online:
        partner_ids = await get_chat_partner_ids(session, current_user.id)
        offline_payload = {
            "user_id": current_user.id,
            "is_online": False,
            "last_seen_at": current_user.last_seen_at.isoformat(),
        }
        await dispatch_webhooks(
            session,
            event="presence.update",
            payload=offline_payload,
            user_ids=partner_ids,
        )
        await broadcast_to_users(
            partner_ids,
            {"event": "presence.update", "data": offline_payload, "timestamp": datetime.now(timezone.utc).isoformat()},
            exclude_user_id=current_user.id,
        )

    return PresenceOut(
        user_id=current_user.id,
        is_online=False,
        last_seen_at=current_user.last_seen_at,
    )
