from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    UniqueConstraint,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


# ======================
# Пользователь
# ======================
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(100), default="")
    password_hash: Mapped[str] = mapped_column(String(255))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    chats: Mapped[list["ChatParticipant"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )

    webhooks: Mapped[list["Webhook"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )

    profile: Mapped["UserProfile | None"] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        uselist=False,
    )
    @property
    def avatar_url(self) -> str | None:
        avatar_path = getattr(self.profile, "avatar_path", None)
        if avatar_path:
            return f"/uploads/{avatar_path}"
        return None

    @property
    def about(self) -> str | None:
        return getattr(self.profile, "about", None)


# ======================
# Профиль пользователя
# ======================
class UserProfile(Base):
    __tablename__ = "user_profiles"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    avatar_path: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )
    about: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    user: Mapped["User"] = relationship(back_populates="profile")


# ======================
# Чат
# ======================
class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chat_type: Mapped[str] = mapped_column(String(20), default="direct", index=True)
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    owner_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    participants: Mapped[list["ChatParticipant"]] = relationship(
        back_populates="chat",
        cascade="all, delete-orphan",
    )

    messages: Mapped[list["Message"]] = relationship(
        back_populates="chat",
        cascade="all, delete-orphan",
    )


# ======================
# Участник чата
# ======================
class ChatParticipant(Base):
    __tablename__ = "chat_participants"

    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )

    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    role: Mapped[str] = mapped_column(String(20), default="member")

    chat: Mapped["Chat"] = relationship(back_populates="participants")
    user: Mapped["User"] = relationship(back_populates="chats")


# ======================
# Сообщение
# ======================
class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"),
        index=True,
    )

    sender_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    reply_to_id: Mapped[int | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    forward_from_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    message_type: Mapped[str] = mapped_column(
        String(30),
        default="text",
    )

    content: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    edited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    read_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    is_pinned: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
    )

    pinned_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    chat: Mapped["Chat"] = relationship(back_populates="messages")

    attachments: Mapped[list["Attachment"]] = relationship(
        back_populates="message",
        cascade="all, delete-orphan",
    )
    reactions: Mapped[list["MessageReaction"]] = relationship(
        back_populates="message",
        cascade="all, delete-orphan",
    )


# ======================
# Вложения
# ======================
class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"),
        index=True,
    )

    file_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)
    storage_path: Mapped[str] = mapped_column(String(500))
    media_kind: Mapped[str] = mapped_column(
        String(20),
        default="file",
    )

    message: Mapped["Message"] = relationship(back_populates="attachments")


# ======================
# Реакции на сообщения
# ======================
class MessageReaction(Base):
    __tablename__ = "message_reactions"
    __table_args__ = (
        UniqueConstraint(
            "message_id",
            "user_id",
            "emoji",
            name="uq_message_reaction",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    emoji: Mapped[str] = mapped_column(String(32))

    message: Mapped["Message"] = relationship(back_populates="reactions")
    user: Mapped["User"] = relationship()


# ======================
# Закреплённые чаты
# ======================
class PinnedChat(Base):
    __tablename__ = "pinned_chats"

    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )

    pinned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )


# ======================
# Блокировки пользователей
# ======================
class BlockedUser(Base):
    __tablename__ = "blocked_users"
    __table_args__ = (
        UniqueConstraint(
            "blocker_id",
            "blocked_id",
            name="uq_blocked_users",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    blocker_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    blocked_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

# ======================
# Вебхуки
# ======================
class Webhook(Base):
    __tablename__ = "webhooks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )

    url: Mapped[str] = mapped_column(String(500))
    secret: Mapped[str] = mapped_column(String(200), default="")
    events: Mapped[str] = mapped_column(String(200), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    user: Mapped["User"] = relationship(back_populates="webhooks")
