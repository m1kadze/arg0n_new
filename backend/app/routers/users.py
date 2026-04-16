from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.db import get_session
from app.deps import get_current_user
from app.models import BlockedUser, User, UserProfile
from app.redis import get_redis, is_user_online
from app.schemas import SearchResult, UserPublic
from app.services.search import search_users
from app.services.uploads import save_upload_file

router = APIRouter(prefix="/users", tags=["users"])
UPLOAD_DIR = Path(settings.upload_dir)


@router.get("/me", response_model=UserPublic)
async def get_me(
    current_user: User = Depends(get_current_user),
    redis=Depends(get_redis),
) -> UserPublic:
    is_online = await is_user_online(redis, current_user.id)
    user_public = UserPublic.model_validate(current_user)
    return user_public.model_copy(update={"is_online": is_online})


@router.patch("/me", response_model=UserPublic)
async def update_profile(
    display_name: str | None = Form(default=None),
    about: str | None = Form(default=None),
    avatar: UploadFile | None = File(default=None),
    remove_avatar: bool = Form(default=False),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> UserPublic:
    if display_name is not None:
        current_user.display_name = display_name.strip() or current_user.username

    profile = await session.get(UserProfile, current_user.id)

    if remove_avatar and profile and profile.avatar_path:
        (UPLOAD_DIR / profile.avatar_path).unlink(missing_ok=True)
        profile.avatar_path = None

    if avatar:
        if profile and profile.avatar_path:
            (UPLOAD_DIR / profile.avatar_path).unlink(missing_ok=True)
        relative_path, _ = await save_upload_file(
            UPLOAD_DIR, avatar, f"avatars/{current_user.id}"
        )
        if not profile:
            profile = UserProfile(user_id=current_user.id, avatar_path=relative_path)
            session.add(profile)
        else:
            profile.avatar_path = relative_path

    if about is not None:
        if not profile:
            profile = UserProfile(user_id=current_user.id)
            session.add(profile)
        normalized = about.strip()
        profile.about = normalized if normalized else None

    session.add(current_user)
    await session.commit()
    result = await session.execute(
        select(User)
        .options(selectinload(User.profile))
        .where(User.id == current_user.id)
    )
    updated_user = result.scalar_one()
    user_public = UserPublic.model_validate(updated_user)
    return user_public


@router.get("/search", response_model=list[SearchResult])
async def search(
    q: str,
    session: AsyncSession = Depends(get_session),
) -> list[SearchResult]:
    results = await search_users(session, q)
    return [
        SearchResult(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            score=score,
        )
        for user, score in results
    ]


@router.get("/blocks", response_model=list[int])
async def list_blocks(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[int]:
    result = await session.execute(
        select(BlockedUser.blocked_id).where(
            BlockedUser.blocker_id == current_user.id
        )
    )
    return list(result.scalars().all())


@router.post("/{user_id}/block")
async def block_user(
    user_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot block yourself")
    target = await session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    existing = await session.execute(
        select(BlockedUser.id).where(
            BlockedUser.blocker_id == current_user.id,
            BlockedUser.blocked_id == user_id,
        )
    )
    if existing.scalar_one_or_none() is None:
        session.add(
            BlockedUser(blocker_id=current_user.id, blocked_id=user_id)
        )
        await session.commit()
    return {"status": "ok"}


@router.delete("/{user_id}/block")
async def unblock_user(
    user_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    existing = await session.execute(
        select(BlockedUser).where(
            BlockedUser.blocker_id == current_user.id,
            BlockedUser.blocked_id == user_id,
        )
    )
    item = existing.scalar_one_or_none()
    if item:
        await session.delete(item)
        await session.commit()
    return {"status": "ok"}


@router.get("/{user_id}", response_model=UserPublic)
async def get_user(
    user_id: int,
    session: AsyncSession = Depends(get_session),
    redis=Depends(get_redis),
) -> UserPublic:
    result = await session.execute(
        select(User)
        .options(selectinload(User.profile))
        .where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    is_online = await is_user_online(redis, user.id)
    user_public = UserPublic.model_validate(user)
    return user_public.model_copy(update={"is_online": is_online})
