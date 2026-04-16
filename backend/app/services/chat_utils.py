from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Chat, ChatParticipant


async def ensure_favorites_chat(session: AsyncSession, user_id: int) -> Chat:
    result = await session.execute(
        select(Chat)
        .join(ChatParticipant)
        .where(
            Chat.chat_type == "favorites",
            Chat.owner_id == user_id,
            ChatParticipant.user_id == user_id,
        )
        .order_by(Chat.id.asc())
    )
    chats = list(result.scalars().all())
    if chats:
        primary = chats[0]
        # Cleanup accidental duplicates.
        for extra in chats[1:]:
            await session.delete(extra)
        if len(chats) > 1:
            await session.commit()
        return primary

    chat = Chat(chat_type="favorites", title="Избранное", owner_id=user_id)
    session.add(chat)
    await session.flush()
    session.add(ChatParticipant(chat_id=chat.id, user_id=user_id, role="owner"))
    await session.commit()
    await session.refresh(chat)
    return chat


async def get_chat_partner_ids(session: AsyncSession, user_id: int) -> list[int]:
    result = await session.execute(
        select(ChatParticipant.chat_id).where(ChatParticipant.user_id == user_id)
    )
    chat_ids = [chat_id for chat_id in result.scalars().all()]
    if not chat_ids:
        return []

    result = await session.execute(
        select(ChatParticipant.user_id)
        .where(
            ChatParticipant.chat_id.in_(chat_ids),
            ChatParticipant.user_id != user_id,
        )
        .distinct()
    )
    return [partner_id for partner_id in result.scalars().all()]
