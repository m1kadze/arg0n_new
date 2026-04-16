from __future__ import annotations

from rapidfuzz import fuzz
from sqlalchemy import or_, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User


async def search_users(
    session: AsyncSession, query: str, limit: int = 20
) -> list[tuple[User, int]]:
    query = query.strip()
    if not query:
        return []

    lowered = query.lower()
    pattern = f"%{lowered}%"

    result = await session.execute(
        select(User)
        .where(
            or_(
                func.lower(User.username).like(pattern),
                func.lower(User.display_name).like(pattern),
            )
        )
        .limit(max(limit * 3, 30))
    )
    candidates = result.scalars().all()

    scored: list[tuple[User, int]] = []
    for user in candidates:
        username_score = fuzz.WRatio(lowered, user.username.lower())
        display_score = fuzz.WRatio(lowered, (user.display_name or "").lower())
        score = int(max(username_score, display_score))
        scored.append((user, score))

    scored.sort(key=lambda item: item[1], reverse=True)
    return scored[:limit]