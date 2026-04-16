from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6, max_length=100)
    display_name: str | None = None


class UserLogin(BaseModel):
    username: str
    password: str


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str
    last_seen_at: datetime | None = None
    avatar_url: str | None = None
    about: str | None = None
    is_online: bool | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class ChatCreate(BaseModel):
    participant_id: int


class GroupCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    member_ids: list[int] = Field(default_factory=list)


class ChannelCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    member_ids: list[int] = Field(default_factory=list)


class ChatParticipantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str
    last_seen_at: datetime | None = None
    avatar_url: str | None = None
    about: str | None = None
    is_online: bool | None = None


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    file_name: str
    content_type: str
    size_bytes: int
    media_kind: str


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    chat_id: int
    sender_id: int | None
    message_type: str
    content: str | None
    reply_to_id: int | None = None
    forward_from_user_id: int | None = None
    created_at: datetime
    edited_at: datetime | None = None
    read_at: datetime | None = None
    is_read: bool = False
    is_pinned: bool = False
    attachments: list[AttachmentOut] = []
    reactions: dict[str, list[int]] = Field(default_factory=dict)


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    reply_to_id: int | None = None
    forward_from_user_id: int | None = None


class MessageUpdate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class MessageReadRequest(BaseModel):
    last_read_message_id: int | None = None


class MessageReactionToggle(BaseModel):
    emoji: str = Field(min_length=1, max_length=32)


class ChatSummary(BaseModel):
    id: int
    chat_type: str
    title: str | None = None
    participant: ChatParticipantOut | None = None
    participants_count: int = 0
    owner_id: int | None = None
    blocked_by_me: bool = False
    blocked_by_other: bool = False
    last_message: MessageOut | None = None
    unread_count: int = 0
    is_pinned: bool = False


class SearchResult(BaseModel):
    id: int
    username: str
    display_name: str
    score: int


class WebhookCreate(BaseModel):
    url: str
    secret: str | None = None
    events: list[str] = Field(default_factory=list)


class WebhookOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    events: list[str]
    enabled: bool
    created_at: datetime


class PresenceOut(BaseModel):
    user_id: int
    is_online: bool
    last_seen_at: datetime | None
