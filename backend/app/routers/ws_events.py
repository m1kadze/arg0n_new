from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.core.security import get_subject_from_token
from app.db import async_session_maker
from app.models import ChatParticipant, User
from app.redis import get_redis_instance, is_user_online, set_user_offline, set_user_online
from app.services.chat_utils import get_chat_partner_ids

logger = logging.getLogger("chatapi.ws")

router = APIRouter(tags=["ws"])

_connections_lock = asyncio.Lock()
_connections: dict[int, set[WebSocket]] = {}


async def _register_connection(user_id: int, ws: WebSocket) -> None:
    async with _connections_lock:
        _connections.setdefault(user_id, set()).add(ws)


async def _unregister_connection(user_id: int, ws: WebSocket) -> None:
    async with _connections_lock:
        sockets = _connections.get(user_id)
        if not sockets:
            return
        sockets.discard(ws)
        if not sockets:
            _connections.pop(user_id, None)


async def _is_user_connected(user_id: int) -> bool:
    async with _connections_lock:
        sockets = _connections.get(user_id)
        return bool(sockets)


async def broadcast_to_users(
    user_ids: list[int],
    payload: dict[str, Any],
    exclude_user_id: int | None = None,
) -> None:
    """Broadcast a JSON event to all connected WebSocket clients for given user IDs."""
    async with _connections_lock:
        targets = [
            ws
            for user_id in user_ids
            if user_id != exclude_user_id
            for ws in _connections.get(user_id, set())
        ]
    for ws in targets:
        try:
            await ws.send_json(payload)
        except Exception:
            pass


async def _broadcast_presence(user_id: int, is_online: bool, last_seen_at: str | None = None) -> None:
    """Notify all chat partners about presence change via WebSocket."""
    async with async_session_maker() as session:
        partner_ids = await get_chat_partner_ids(session, user_id)

    payload: dict[str, Any] = {
        "event": "presence.update",
        "data": {
            "user_id": user_id,
            "is_online": is_online,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if last_seen_at:
        payload["data"]["last_seen_at"] = last_seen_at

    await broadcast_to_users(partner_ids, payload)


@router.websocket("/ws/events")
async def events_ws(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token")
    subject = get_subject_from_token(token) if token else None
    if not subject:
        await websocket.close(code=1008)
        return
    try:
        user_id = int(subject)
    except ValueError:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    await _register_connection(user_id, websocket)
    logger.info("WS connected: user=%s", user_id)

    # Mark user online on connect
    redis = await get_redis_instance()
    was_online = await is_user_online(redis, user_id)
    await set_user_online(redis, user_id)
    if not was_online:
        async with async_session_maker() as session:
            result = await session.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if user:
                user.last_seen_at = datetime.now(timezone.utc)
                session.add(user)
                await session.commit()
        await _broadcast_presence(user_id, True)

    try:
        while True:
            # Keep connection alive; client sends pings or typing indicators
            data = await websocket.receive_json()
            if not isinstance(data, dict):
                continue
            msg_type = data.get("type")
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
            elif msg_type == "typing":
                chat_id = data.get("chat_id")
                if isinstance(chat_id, int):
                    async with async_session_maker() as session:
                        result = await session.execute(
                            select(ChatParticipant.user_id).where(
                                ChatParticipant.chat_id == chat_id
                            )
                        )
                        participants = list(result.scalars().all())
                    if user_id in participants:
                        await broadcast_to_users(
                            participants,
                            {
                                "event": "typing",
                                "data": {"chat_id": chat_id, "user_id": user_id},
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                            },
                            exclude_user_id=user_id,
                        )
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WS error: user=%s", user_id)
    finally:
        await _unregister_connection(user_id, websocket)
        logger.info("WS disconnected: user=%s", user_id)

        # Mark offline only if no other connections remain
        still_connected = await _is_user_connected(user_id)
        if not still_connected:
            redis = await get_redis_instance()
            await set_user_offline(redis, user_id)
            last_seen = datetime.now(timezone.utc)
            async with async_session_maker() as session:
                result = await session.execute(select(User).where(User.id == user_id))
                user = result.scalar_one_or_none()
                if user:
                    user.last_seen_at = last_seen
                    session.add(user)
                    await session.commit()
            await _broadcast_presence(user_id, False, last_seen.isoformat())


@router.get("/ws/events")
async def events_ws_http_fallback() -> dict:
    raise HTTPException(
        status_code=426,
        detail="WebSocket endpoint. Use ws/wss with Upgrade headers.",
    )
