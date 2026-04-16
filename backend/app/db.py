from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

from app.core.config import settings

Base = declarative_base()

async_engine = create_async_engine(settings.database_url, echo=False, future=True)
async_session_maker = async_sessionmaker(async_engine, expire_on_commit=False)


@event.listens_for(Engine, "connect")
def _set_sqlite_pragma(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


async def get_session() -> AsyncSession:
    async with async_session_maker() as session:
        yield session


async def init_db() -> None:
    # Ensure models are imported so metadata is populated.
    from app import models  # noqa: F401

    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        result = await conn.exec_driver_sql("PRAGMA table_info(messages)")
        columns = {row[1] for row in result}
        if "reply_to_id" not in columns:
            await conn.exec_driver_sql(
                "ALTER TABLE messages ADD COLUMN reply_to_id INTEGER"
            )
        if "forward_from_user_id" not in columns:
            await conn.exec_driver_sql(
                "ALTER TABLE messages ADD COLUMN forward_from_user_id INTEGER"
            )
        await conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_messages_reply_to_id ON messages (reply_to_id)"
        )
        await conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_messages_forward_from_user_id "
            "ON messages (forward_from_user_id)"
        )

        result = await conn.exec_driver_sql("PRAGMA table_info(user_profiles)")
        profile_columns = {row[1] for row in result}
        if "about" not in profile_columns:
            await conn.exec_driver_sql(
                "ALTER TABLE user_profiles ADD COLUMN about VARCHAR(500)"
            )

        result = await conn.exec_driver_sql("PRAGMA table_info(chats)")
        chat_columns = {row[1] for row in result}
        if "chat_type" not in chat_columns:
            await conn.exec_driver_sql(
                "ALTER TABLE chats ADD COLUMN chat_type VARCHAR(20) DEFAULT 'direct'"
            )
            await conn.exec_driver_sql(
                "UPDATE chats SET chat_type = 'direct' WHERE chat_type IS NULL"
            )
        if "title" not in chat_columns:
            await conn.exec_driver_sql("ALTER TABLE chats ADD COLUMN title VARCHAR(200)")
        if "owner_id" not in chat_columns:
            await conn.exec_driver_sql(
                "ALTER TABLE chats ADD COLUMN owner_id INTEGER"
            )
        await conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_chats_chat_type ON chats (chat_type)"
        )
        await conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_chats_owner_id ON chats (owner_id)"
        )

        result = await conn.exec_driver_sql("PRAGMA table_info(chat_participants)")
        participant_columns = {row[1] for row in result}
        if "role" not in participant_columns:
            await conn.exec_driver_sql(
                "ALTER TABLE chat_participants ADD COLUMN role VARCHAR(20) DEFAULT 'member'"
            )
            await conn.exec_driver_sql(
                "UPDATE chat_participants SET role = 'member' WHERE role IS NULL"
            )
