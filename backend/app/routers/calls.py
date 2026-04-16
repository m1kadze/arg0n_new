from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.core.security import get_subject_from_token
from app.db import async_session_maker
from app.models import ChatParticipant

router = APIRouter(prefix="/calls", tags=["calls"])

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


async def _broadcast_to_users(
    user_ids: list[int], payload: dict[str, Any], exclude_user_id: int
) -> None:
    async with _connections_lock:
        targets = [
            (user_id, ws)
            for user_id in user_ids
            if user_id != exclude_user_id
            for ws in _connections.get(user_id, set())
        ]
    for _user_id, ws in targets:
        try:
            await ws.send_json(payload)
        except Exception:
            # Ignore broken sockets; they will be cleaned up on disconnect.
            pass


async def _get_chat_participants(chat_id: int) -> list[int]:
    async with async_session_maker() as session:
        result = await session.execute(
            select(ChatParticipant.user_id).where(ChatParticipant.chat_id == chat_id)
        )
        return list(result.scalars().all())


@router.websocket("/ws")
async def calls_ws(websocket: WebSocket):
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

    try:
        while True:
            data = await websocket.receive_json()
            if not isinstance(data, dict):
                continue
            message_type = data.get("type")
            chat_id = data.get("chat_id")
            if not isinstance(chat_id, int):
                continue
            if message_type not in {
                "call.offer",
                "call.answer",
                "call.ice",
                "call.decline",
                "call.end",
            }:
                continue

            participants = await _get_chat_participants(chat_id)
            if user_id not in participants:
                continue

            payload = {
                **data,
                "from_user_id": user_id,
            }
            await _broadcast_to_users(participants, payload, user_id)
    except WebSocketDisconnect:
        pass
    finally:
        await _unregister_connection(user_id, websocket)


@router.get("/ws")
async def calls_ws_http_fallback() -> dict:
    raise HTTPException(
        status_code=426,
        detail="WebSocket endpoint. Use ws/wss with Upgrade headers.",
    )
