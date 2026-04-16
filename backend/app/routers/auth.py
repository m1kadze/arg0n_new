from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import create_access_token, hash_password, verify_password
from app.db import get_session
from app.models import User
from app.redis import get_redis, is_user_online, set_user_online
from app.schemas import TokenResponse, UserCreate, UserLogin, UserPublic
from app.services.chat_utils import ensure_favorites_chat, get_chat_partner_ids
from app.services.webhooks import dispatch_webhooks

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
async def register(
    data: UserCreate,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
) -> TokenResponse:
    result = await session.execute(
        select(User).where(func.lower(User.username) == data.username.lower())
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")

    user = User(
        username=data.username,
        display_name=data.display_name or data.username,
        password_hash=hash_password(data.password),
    )
    session.add(user)
    await session.commit()
    await ensure_favorites_chat(session, user.id)
    result = await session.execute(
        select(User)
        .options(selectinload(User.profile))
        .where(User.id == user.id)
    )
    user = result.scalar_one()

    was_online = await is_user_online(redis, user.id)
    await set_user_online(redis, user.id)
    if not was_online:
        partner_ids = await get_chat_partner_ids(session, user.id)
        await dispatch_webhooks(
            session,
            event="presence.update",
            payload={"user_id": user.id, "is_online": True},
            user_ids=partner_ids,
        )

    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token, user=UserPublic.model_validate(user))


@router.post("/login", response_model=TokenResponse)
async def login(
    data: UserLogin,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
) -> TokenResponse:
    result = await session.execute(
        select(User)
        .options(selectinload(User.profile))
        .where(func.lower(User.username) == data.username.lower())
    )
    user = result.scalar_one_or_none()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )

    await ensure_favorites_chat(session, user.id)
    was_online = await is_user_online(redis, user.id)
    await set_user_online(redis, user.id)
    if not was_online:
        partner_ids = await get_chat_partner_ids(session, user.id)
        await dispatch_webhooks(
            session,
            event="presence.update",
            payload={"user_id": user.id, "is_online": True},
            user_ids=partner_ids,
        )

    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token, user=UserPublic.model_validate(user))
