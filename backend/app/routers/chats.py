from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.db import get_session
from app.deps import get_current_user
from app.models import (
    Attachment,
    BlockedUser,
    Chat,
    ChatParticipant,
    Message,
    MessageReaction,
    PinnedChat,
    User,
)
from app.redis import get_redis, is_user_online
from app.schemas import (
    AttachmentOut,
    ChatCreate,
    ChatParticipantOut,
    ChatSummary,
    ChannelCreate,
    GroupCreate,
    MessageCreate,
    MessageReactionToggle,
    MessageReadRequest,
    MessageOut,
    MessageUpdate,
)
from app.services.chat_utils import ensure_favorites_chat
from app.services.uploads import detect_media_kind, save_upload_file
from app.services.webhooks import dispatch_webhooks
from app.routers.ws_events import broadcast_to_users

router = APIRouter(prefix="/chats", tags=["chats"])

UPLOAD_DIR = Path(settings.upload_dir)


async def _get_chat_for_user(
    session: AsyncSession, chat_id: int, user_id: int
) -> Chat:
    result = await session.execute(
        select(Chat)
        .join(ChatParticipant)
        .where(Chat.id == chat_id, ChatParticipant.user_id == user_id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    return chat


async def _count_participants(session: AsyncSession, chat_id: int) -> int:
    result = await session.execute(
        select(func.count(ChatParticipant.user_id)).where(
            ChatParticipant.chat_id == chat_id
        )
    )
    return int(result.scalar_one())


def _resolve_chat_title(chat: Chat) -> str | None:
    if chat.chat_type == "favorites":
        return chat.title or "Избранное"
    if chat.chat_type in {"group", "channel"}:
        return chat.title or "Без названия"
    return None


async def _ensure_can_send(chat: Chat, current_user: User) -> None:
    if chat.chat_type == "channel" and chat.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only owner can post in channel")
    if chat.chat_type == "favorites" and chat.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only owner can post in favorites")


async def _ensure_not_blocked(
    session: AsyncSession, chat: Chat, current_user: User
) -> None:
    if chat.chat_type != "direct":
        return
    result = await session.execute(
        select(ChatParticipant.user_id).where(
            ChatParticipant.chat_id == chat.id,
            ChatParticipant.user_id != current_user.id,
        )
    )
    other_id = result.scalar_one_or_none()
    if not other_id:
        return
    blocked_by_other = await session.execute(
        select(BlockedUser.id).where(
            BlockedUser.blocker_id == other_id,
            BlockedUser.blocked_id == current_user.id,
        )
    )
    if blocked_by_other.scalar_one_or_none() is not None:
        raise HTTPException(status_code=403, detail="You are blocked by this user")
    blocked_by_me = await session.execute(
        select(BlockedUser.id).where(
            BlockedUser.blocker_id == current_user.id,
            BlockedUser.blocked_id == other_id,
        )
    )
    if blocked_by_me.scalar_one_or_none() is not None:
        raise HTTPException(status_code=403, detail="You blocked this user")


async def _ensure_reply_target(
    session: AsyncSession, chat_id: int, reply_to_id: int | None
) -> int | None:
    if not reply_to_id:
        return None
    result = await session.execute(
        select(Message.id).where(
            Message.id == reply_to_id, Message.chat_id == chat_id
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Reply message not found")
    return reply_to_id


async def _ensure_forward_user(
    session: AsyncSession, forward_from_user_id: int | None
) -> int | None:
    if not forward_from_user_id:
        return None
    user = await session.get(User, forward_from_user_id)
    if not user:
        raise HTTPException(status_code=400, detail="Forward author not found")
    return forward_from_user_id


def _attachment_to_out(attachment: Attachment) -> AttachmentOut:
    url = f"/uploads/{attachment.storage_path}"
    return AttachmentOut(
        id=attachment.id,
        url=url,
        file_name=attachment.file_name,
        content_type=attachment.content_type,
        size_bytes=attachment.size_bytes,
        media_kind=attachment.media_kind,
    )


async def _load_attachments(
    session: AsyncSession, message_ids: list[int]
) -> dict[int, list[AttachmentOut]]:
    if not message_ids:
        return {}

    result = await session.execute(
        select(Attachment).where(Attachment.message_id.in_(message_ids))
    )
    attachments = result.scalars().all()
    grouped: dict[int, list[AttachmentOut]] = {message_id: [] for message_id in message_ids}
    for attachment in attachments:
        grouped.setdefault(attachment.message_id, []).append(
            _attachment_to_out(attachment)
        )
    return grouped


async def _load_reactions(
    session: AsyncSession, message_ids: list[int]
) -> dict[int, dict[str, list[int]]]:
    if not message_ids:
        return {}

    result = await session.execute(
        select(MessageReaction).where(MessageReaction.message_id.in_(message_ids))
    )
    reactions = result.scalars().all()
    grouped: dict[int, dict[str, list[int]]] = {
        message_id: {} for message_id in message_ids
    }
    for reaction in reactions:
        emoji_map = grouped.setdefault(reaction.message_id, {})
        emoji_map.setdefault(reaction.emoji, []).append(reaction.user_id)
    return grouped


async def _messages_to_out(
    session: AsyncSession, messages: list[Message]
) -> list[MessageOut]:
    message_ids = [message.id for message in messages]
    attachments_map = await _load_attachments(session, message_ids)
    reactions_map = await _load_reactions(session, message_ids)
    items: list[MessageOut] = []
    for message in messages:
        items.append(
            MessageOut(
                id=message.id,
                chat_id=message.chat_id,
                sender_id=message.sender_id,
                message_type=message.message_type,
                content=message.content,
                reply_to_id=message.reply_to_id,
                forward_from_user_id=message.forward_from_user_id,
                created_at=message.created_at,
                edited_at=message.edited_at,
                read_at=message.read_at,
                is_read=message.read_at is not None,
                is_pinned=message.is_pinned,
                attachments=attachments_map.get(message.id, []),
                reactions=reactions_map.get(message.id, {}),
            )
        )
    return items


async def _get_other_participant_ids(
    session: AsyncSession, chat_id: int, current_user_id: int
) -> list[int]:
    result = await session.execute(
        select(ChatParticipant.user_id).where(
            ChatParticipant.chat_id == chat_id,
            ChatParticipant.user_id != current_user_id,
        )
    )
    return list(result.scalars().all())


async def _build_chat_summary(
    session: AsyncSession, chat: Chat, current_user_id: int, redis
) -> ChatSummary:
    chat_type = chat.chat_type or "direct"
    participant = None
    title = _resolve_chat_title(chat)
    blocked_by_other = False
    blocked_by_me = False
    if chat_type == "direct":
        result = await session.execute(
            select(User)
            .options(selectinload(User.profile))
            .join(ChatParticipant)
            .where(
                ChatParticipant.chat_id == chat.id,
                ChatParticipant.user_id != current_user_id,
            )
        )
        other = result.scalar_one_or_none()
        if not other:
            participants_count = await _count_participants(session, chat.id)
            if participants_count <= 1:
                # Fix legacy/incorrect direct chats that are actually favorites.
                chat.chat_type = "favorites"
                chat.title = chat.title or "Избранное"
                if not chat.owner_id:
                    chat.owner_id = current_user_id
                session.add(chat)
                await session.commit()
                return ChatSummary(
                    id=chat.id,
                    chat_type="favorites",
                    title=_resolve_chat_title(chat),
                    participant=None,
                    participants_count=participants_count,
                    owner_id=chat.owner_id,
                    blocked_by_me=False,
                    blocked_by_other=False,
                    last_message=None,
                    unread_count=0,
                    is_pinned=False,
                )
            raise HTTPException(
                status_code=400, detail="Chat has no other participant"
            )

        is_online = await is_user_online(redis, other.id)
        participant = ChatParticipantOut(
            id=other.id,
            username=other.username,
            display_name=other.display_name,
            last_seen_at=other.last_seen_at,
            avatar_url=other.avatar_url,
            about=getattr(other.profile, "about", None),
            is_online=is_online,
        )
        block_other = await session.execute(
            select(BlockedUser.id).where(
                BlockedUser.blocker_id == other.id,
                BlockedUser.blocked_id == current_user_id,
            )
        )
        blocked_by_other = block_other.scalar_one_or_none() is not None
        block_me = await session.execute(
            select(BlockedUser.id).where(
                BlockedUser.blocker_id == current_user_id,
                BlockedUser.blocked_id == other.id,
            )
        )
        blocked_by_me = block_me.scalar_one_or_none() is not None

    result = await session.execute(
        select(Message)
        .where(Message.chat_id == chat.id)
        .order_by(Message.id.desc())
        .limit(1)
    )
    last_message = result.scalar_one_or_none()
    last_message_out = None
    if last_message:
        last_message_out = (await _messages_to_out(session, [last_message]))[0]

    unread_result = await session.execute(
        select(func.count(Message.id)).where(
            Message.chat_id == chat.id,
            Message.sender_id != current_user_id,
            Message.read_at.is_(None),
        )
    )
    unread_count = unread_result.scalar_one()

    pinned_result = await session.execute(
        select(PinnedChat.pinned_at).where(
            PinnedChat.chat_id == chat.id,
            PinnedChat.user_id == current_user_id,
        )
    )
    is_pinned = pinned_result.scalar_one_or_none() is not None

    participants_count = await _count_participants(session, chat.id)

    return ChatSummary(
        id=chat.id,
        chat_type=chat_type,
        title=title,
        participant=participant,
        participants_count=participants_count,
        owner_id=chat.owner_id,
        blocked_by_me=blocked_by_me,
        blocked_by_other=blocked_by_other,
        last_message=last_message_out,
        unread_count=unread_count,
        is_pinned=is_pinned,
    )


@router.post("", response_model=ChatSummary)
async def create_chat(
    data: ChatCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    redis=Depends(get_redis),
) -> ChatSummary:
    if data.participant_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot chat with yourself")

    result = await session.execute(
        select(User)
        .options(selectinload(User.profile))
        .where(User.id == data.participant_id)
    )
    other = result.scalar_one_or_none()
    if not other:
        raise HTTPException(status_code=404, detail="Participant not found")

    result = await session.execute(
        select(Chat.id)
        .join(ChatParticipant)
        .where(
            Chat.chat_type == "direct",
            ChatParticipant.user_id.in_([current_user.id, data.participant_id]),
        )
        .group_by(Chat.id)
        .having(func.count(ChatParticipant.user_id) == 2)
    )
    existing_chat_id = result.scalar_one_or_none()

    if existing_chat_id:
        chat = await session.get(Chat, existing_chat_id)
    else:
        chat = Chat(chat_type="direct")
        session.add(chat)
        await session.flush()
        session.add_all(
            [
                ChatParticipant(chat_id=chat.id, user_id=current_user.id, role="owner"),
                ChatParticipant(chat_id=chat.id, user_id=other.id, role="member"),
            ]
        )
        await session.commit()
        await session.refresh(chat)

    return await _build_chat_summary(session, chat, current_user.id, redis)


@router.post("/groups", response_model=ChatSummary)
async def create_group(
    data: GroupCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    redis=Depends(get_redis),
) -> ChatSummary:
    title = data.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    chat = Chat(chat_type="group", title=title, owner_id=current_user.id)
    session.add(chat)
    await session.flush()

    participant_ids = {current_user.id, *data.member_ids}
    users_result = await session.execute(
        select(User.id).where(User.id.in_(participant_ids))
    )
    existing_ids = set(users_result.scalars().all())
    if current_user.id not in existing_ids:
        raise HTTPException(status_code=400, detail="Owner not found")
    missing_ids = set(data.member_ids) - existing_ids
    if missing_ids:
        raise HTTPException(status_code=404, detail="Participant not found")

    participants = [
        ChatParticipant(
            chat_id=chat.id,
            user_id=current_user.id,
            role="owner",
        )
    ]
    for user_id in existing_ids:
        if user_id == current_user.id:
            continue
        participants.append(
            ChatParticipant(chat_id=chat.id, user_id=user_id, role="member")
        )
    session.add_all(participants)
    await session.commit()
    await session.refresh(chat)
    return await _build_chat_summary(session, chat, current_user.id, redis)


@router.post("/channels", response_model=ChatSummary)
async def create_channel(
    data: ChannelCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    redis=Depends(get_redis),
) -> ChatSummary:
    title = data.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    chat = Chat(chat_type="channel", title=title, owner_id=current_user.id)
    session.add(chat)
    await session.flush()

    participant_ids = {current_user.id, *data.member_ids}
    users_result = await session.execute(
        select(User.id).where(User.id.in_(participant_ids))
    )
    existing_ids = set(users_result.scalars().all())
    if current_user.id not in existing_ids:
        raise HTTPException(status_code=400, detail="Owner not found")
    missing_ids = set(data.member_ids) - existing_ids
    if missing_ids:
        raise HTTPException(status_code=404, detail="Participant not found")

    participants = [
        ChatParticipant(
            chat_id=chat.id,
            user_id=current_user.id,
            role="owner",
        )
    ]
    for user_id in existing_ids:
        if user_id == current_user.id:
            continue
        participants.append(
            ChatParticipant(chat_id=chat.id, user_id=user_id, role="member")
        )
    session.add_all(participants)
    await session.commit()
    await session.refresh(chat)
    return await _build_chat_summary(session, chat, current_user.id, redis)


@router.get("", response_model=list[ChatSummary])
async def list_chats(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    redis=Depends(get_redis),
) -> list[ChatSummary]:
    await ensure_favorites_chat(session, current_user.id)
    result = await session.execute(
        select(Chat)
        .join(ChatParticipant)
        .where(ChatParticipant.user_id == current_user.id)
    )
    chats = result.scalars().all()

    summaries: list[ChatSummary] = []
    for chat in chats:
        summaries.append(await _build_chat_summary(session, chat, current_user.id, redis))
    return summaries


@router.post("/{chat_id}/pin")
async def pin_chat(
    chat_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    await _get_chat_for_user(session, chat_id, current_user.id)

    pinned = await session.get(PinnedChat, (chat_id, current_user.id))
    now = datetime.now(timezone.utc)
    if pinned:
        pinned.pinned_at = now
    else:
        pinned = PinnedChat(chat_id=chat_id, user_id=current_user.id, pinned_at=now)
        session.add(pinned)

    await session.commit()
    partners = await _get_other_participant_ids(session, chat_id, current_user.id)
    ws_payload = {
        "event": "chat.pinned",
        "data": {"chat_id": chat_id, "user_id": current_user.id},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    await dispatch_webhooks(
        session,
        event="chat.pinned",
        payload={"chat_id": chat_id, "user_id": current_user.id},
        user_ids=partners,
    )
    await broadcast_to_users(partners, ws_payload, exclude_user_id=current_user.id)
    return {"status": "ok"}


@router.post("/{chat_id}/unpin")
async def unpin_chat(
    chat_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    await _get_chat_for_user(session, chat_id, current_user.id)

    pinned = await session.get(PinnedChat, (chat_id, current_user.id))
    if pinned:
        await session.delete(pinned)
        await session.commit()
        partners = await _get_other_participant_ids(
            session, chat_id, current_user.id
        )
        ws_payload = {
            "event": "chat.unpinned",
            "data": {"chat_id": chat_id, "user_id": current_user.id},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await dispatch_webhooks(
            session,
            event="chat.unpinned",
            payload={"chat_id": chat_id, "user_id": current_user.id},
            user_ids=partners,
        )
        await broadcast_to_users(partners, ws_payload, exclude_user_id=current_user.id)
    return {"status": "ok"}


@router.get("/{chat_id}/messages", response_model=list[MessageOut])
async def list_messages(
    chat_id: int,
    before_id: int | None = None,
    limit: int = 50,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[MessageOut]:
    await _get_chat_for_user(session, chat_id, current_user.id)

    query = select(Message).where(Message.chat_id == chat_id)
    if before_id:
        query = query.where(Message.id < before_id)
    query = query.order_by(Message.id.desc()).limit(min(limit, 200))

    result = await session.execute(query)
    messages = result.scalars().all()
    messages.reverse()
    return await _messages_to_out(session, messages)


@router.post("/{chat_id}/read")
async def mark_read(
    chat_id: int,
    data: MessageReadRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    await _get_chat_for_user(session, chat_id, current_user.id)

    query = update(Message).where(
        Message.chat_id == chat_id, Message.sender_id != current_user.id
    )
    if data.last_read_message_id:
        query = query.where(Message.id <= data.last_read_message_id)
    now = datetime.now(timezone.utc)
    query = query.values(read_at=now, read_by_id=current_user.id)
    await session.execute(query)
    await session.commit()
    return {"status": "ok"}


@router.post(
    "/{chat_id}/messages/{message_id}/reactions",
    response_model=MessageOut,
)
async def toggle_message_reaction(
    chat_id: int,
    message_id: int,
    data: MessageReactionToggle,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> MessageOut:
    await _get_chat_for_user(session, chat_id, current_user.id)

    result = await session.execute(
        select(Message).where(Message.id == message_id, Message.chat_id == chat_id)
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    emoji = data.emoji.strip()
    if not emoji:
        raise HTTPException(status_code=400, detail="Emoji is required")

    existing = await session.execute(
        select(MessageReaction).where(
            MessageReaction.message_id == message_id,
            MessageReaction.user_id == current_user.id,
            MessageReaction.emoji == emoji,
        )
    )
    reaction = existing.scalar_one_or_none()
    if reaction:
        await session.delete(reaction)
    else:
        session.add(
            MessageReaction(
                message_id=message_id,
                user_id=current_user.id,
                emoji=emoji,
            )
        )

    await session.commit()

    partners = await _get_other_participant_ids(session, chat_id, current_user.id)
    reaction_payload = {
        "chat_id": chat_id,
        "message_id": message_id,
        "emoji": emoji,
        "user_id": current_user.id,
    }
    await dispatch_webhooks(
        session,
        event="message.reaction",
        payload=reaction_payload,
        user_ids=partners,
    )
    await broadcast_to_users(
        partners,
        {"event": "message.reaction", "data": reaction_payload, "timestamp": datetime.now(timezone.utc).isoformat()},
        exclude_user_id=current_user.id,
    )

    return (await _messages_to_out(session, [message]))[0]


@router.post("/{chat_id}/messages", response_model=MessageOut)
async def send_text_message(
    chat_id: int,
    data: MessageCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> MessageOut:
    chat = await _get_chat_for_user(session, chat_id, current_user.id)
    await _ensure_can_send(chat, current_user)
    await _ensure_not_blocked(session, chat, current_user)

    reply_to_id = await _ensure_reply_target(session, chat_id, data.reply_to_id)
    forward_from_user_id = await _ensure_forward_user(
        session, data.forward_from_user_id
    )

    message = Message(
        chat_id=chat_id,
        sender_id=current_user.id,
        message_type="text",
        content=data.content,
        reply_to_id=reply_to_id,
        forward_from_user_id=forward_from_user_id,
    )
    session.add(message)
    await session.commit()
    await session.refresh(message)

    partners = await _get_other_participant_ids(session, chat_id, current_user.id)
    msg_payload = {
        "chat_id": chat_id,
        "message_id": message.id,
        "sender_id": current_user.id,
        "content": message.content,
        "message_type": message.message_type,
    }
    await dispatch_webhooks(
        session,
        event="message.new",
        payload=msg_payload,
        user_ids=partners,
    )
    await broadcast_to_users(
        partners,
        {"event": "message.new", "data": msg_payload, "timestamp": datetime.now(timezone.utc).isoformat()},
        exclude_user_id=current_user.id,
    )

    return (await _messages_to_out(session, [message]))[0]


@router.patch("/{chat_id}/messages/{message_id}", response_model=MessageOut)
async def update_message(
    chat_id: int,
    message_id: int,
    data: MessageUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> MessageOut:
    await _get_chat_for_user(session, chat_id, current_user.id)

    result = await session.execute(
        select(Message).where(Message.id == message_id, Message.chat_id == chat_id)
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    if message.sender_id != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot edit this message")
    if message.message_type != "text":
        raise HTTPException(status_code=400, detail="Only text messages can be edited")

    message.content = data.content
    message.edited_at = datetime.now(timezone.utc)
    session.add(message)
    await session.commit()
    await session.refresh(message)
    return (await _messages_to_out(session, [message]))[0]


@router.delete("/{chat_id}/messages/{message_id}")
async def delete_message(
    chat_id: int,
    message_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    await _get_chat_for_user(session, chat_id, current_user.id)

    result = await session.execute(
        select(Message).where(Message.id == message_id, Message.chat_id == chat_id)
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    if message.sender_id != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot delete this message")

    result = await session.execute(
        select(Attachment).where(Attachment.message_id == message.id)
    )
    attachments = result.scalars().all()
    for attachment in attachments:
        file_path = UPLOAD_DIR / attachment.storage_path
        try:
            file_path.unlink(missing_ok=True)
        except OSError:
            pass

    await session.delete(message)
    await session.commit()
    return {"status": "ok"}


@router.post("/{chat_id}/messages/{message_id}/pin", response_model=MessageOut)
async def pin_message(
    chat_id: int,
    message_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> MessageOut:
    await _get_chat_for_user(session, chat_id, current_user.id)

    result = await session.execute(
        select(Message).where(Message.id == message_id, Message.chat_id == chat_id)
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    message.is_pinned = True
    message.pinned_at = datetime.now(timezone.utc)
    session.add(message)
    await session.commit()
    await session.refresh(message)
    partners = await _get_other_participant_ids(session, chat_id, current_user.id)
    pin_payload = {
        "chat_id": chat_id,
        "message_id": message.id,
        "sender_id": current_user.id,
    }
    await dispatch_webhooks(
        session,
        event="message.pinned",
        payload=pin_payload,
        user_ids=partners,
    )
    await broadcast_to_users(
        partners,
        {"event": "message.pinned", "data": pin_payload, "timestamp": datetime.now(timezone.utc).isoformat()},
        exclude_user_id=current_user.id,
    )
    return (await _messages_to_out(session, [message]))[0]


@router.post("/{chat_id}/messages/{message_id}/unpin", response_model=MessageOut)
async def unpin_message(
    chat_id: int,
    message_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> MessageOut:
    await _get_chat_for_user(session, chat_id, current_user.id)

    result = await session.execute(
        select(Message).where(Message.id == message_id, Message.chat_id == chat_id)
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    message.is_pinned = False
    message.pinned_at = None
    session.add(message)
    await session.commit()
    await session.refresh(message)
    partners = await _get_other_participant_ids(session, chat_id, current_user.id)
    unpin_payload = {
        "chat_id": chat_id,
        "message_id": message.id,
        "sender_id": current_user.id,
    }
    await dispatch_webhooks(
        session,
        event="message.unpinned",
        payload=unpin_payload,
        user_ids=partners,
    )
    await broadcast_to_users(
        partners,
        {"event": "message.unpinned", "data": unpin_payload, "timestamp": datetime.now(timezone.utc).isoformat()},
        exclude_user_id=current_user.id,
    )
    return (await _messages_to_out(session, [message]))[0]


@router.get("/{chat_id}/pinned", response_model=list[MessageOut])
async def list_pinned_messages(
    chat_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[MessageOut]:
    await _get_chat_for_user(session, chat_id, current_user.id)

    result = await session.execute(
        select(Message)
        .where(Message.chat_id == chat_id, Message.is_pinned.is_(True))
        .order_by(Message.pinned_at.desc(), Message.id.desc())
    )
    messages = result.scalars().all()
    return await _messages_to_out(session, messages)


@router.post("/{chat_id}/messages/attachments", response_model=MessageOut)
async def send_attachments(
    chat_id: int,
    text: str | None = Form(default=None),
    reply_to_id: int | None = Form(default=None),
    forward_from_user_id: int | None = Form(default=None),
    files: list[UploadFile] = File(...),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> MessageOut:
    chat = await _get_chat_for_user(session, chat_id, current_user.id)
    await _ensure_can_send(chat, current_user)
    await _ensure_not_blocked(session, chat, current_user)

    reply_to_id = await _ensure_reply_target(session, chat_id, reply_to_id)
    forward_from_user_id = await _ensure_forward_user(
        session, forward_from_user_id
    )

    message = Message(
        chat_id=chat_id,
        sender_id=current_user.id,
        message_type="attachment",
        content=text,
        reply_to_id=reply_to_id,
        forward_from_user_id=forward_from_user_id,
    )
    session.add(message)
    await session.flush()

    prefix = f"{chat_id}/{message.id}"
    for upload in files:
        relative_path, size = await save_upload_file(UPLOAD_DIR, upload, prefix)
        attachment = Attachment(
            message_id=message.id,
            file_name=upload.filename or "file",
            content_type=upload.content_type or "application/octet-stream",
            size_bytes=size,
            storage_path=relative_path,
            media_kind=detect_media_kind(upload.content_type),
        )
        session.add(attachment)

    await session.commit()
    await session.refresh(message)

    partners = await _get_other_participant_ids(session, chat_id, current_user.id)
    att_payload = {
        "chat_id": chat_id,
        "message_id": message.id,
        "sender_id": current_user.id,
        "content": message.content,
        "message_type": message.message_type,
    }
    await dispatch_webhooks(
        session,
        event="message.new",
        payload=att_payload,
        user_ids=partners,
    )
    await broadcast_to_users(
        partners,
        {"event": "message.new", "data": att_payload, "timestamp": datetime.now(timezone.utc).isoformat()},
        exclude_user_id=current_user.id,
    )

    return (await _messages_to_out(session, [message]))[0]


@router.delete("/{chat_id}")
async def delete_chat(
    chat_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    chat = await _get_chat_for_user(session, chat_id, current_user.id)
    if chat.chat_type == "favorites":
        raise HTTPException(status_code=403, detail="Cannot delete favorites")

    if chat.chat_type in {"group", "channel"}:
        if chat.owner_id == current_user.id:
            await session.delete(chat)
            await session.commit()
            return {"status": "ok"}

    participant = await session.get(ChatParticipant, (chat_id, current_user.id))
    if participant:
        await session.delete(participant)
        await session.commit()

    remaining = await session.execute(
        select(func.count(ChatParticipant.user_id)).where(
            ChatParticipant.chat_id == chat_id
        )
    )
    if remaining.scalar_one() == 0:
        chat = await session.get(Chat, chat_id)
        if chat:
            await session.delete(chat)
            await session.commit()

    return {"status": "ok"}
