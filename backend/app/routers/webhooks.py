from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_current_user
from app.models import User, Webhook
from app.schemas import WebhookCreate, WebhookOut
from app.services.webhooks import events_to_string, parse_events

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.get("", response_model=list[WebhookOut])
async def list_webhooks(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[WebhookOut]:
    result = await session.execute(
        select(Webhook).where(Webhook.user_id == current_user.id)
    )
    hooks = result.scalars().all()
    return [
        WebhookOut(
            id=hook.id,
            url=hook.url,
            events=sorted(parse_events(hook.events)),
            enabled=hook.enabled,
            created_at=hook.created_at,
        )
        for hook in hooks
    ]


@router.post("", response_model=WebhookOut)
async def create_webhook(
    data: WebhookCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WebhookOut:
    hook = Webhook(
        user_id=current_user.id,
        url=data.url,
        secret=data.secret or "",
        events=events_to_string(data.events),
        enabled=True,
    )
    session.add(hook)
    await session.commit()
    await session.refresh(hook)

    return WebhookOut(
        id=hook.id,
        url=hook.url,
        events=sorted(parse_events(hook.events)),
        enabled=hook.enabled,
        created_at=hook.created_at,
    )


@router.delete("/{webhook_id}")
async def delete_webhook(
    webhook_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    result = await session.execute(
        select(Webhook).where(
            Webhook.id == webhook_id, Webhook.user_id == current_user.id
        )
    )
    hook = result.scalar_one_or_none()
    if not hook:
        raise HTTPException(status_code=404, detail="Webhook not found")

    await session.delete(hook)
    await session.commit()
    return {"status": "ok"}