import { useCallback, useEffect, useRef, useState } from 'react';
import { api, buildApiUrl } from '../core/api';
import type { WebhookEvent } from '../core/types';

const POLL_INTERVAL_MS = 2500;

export function useWebhooks(
  currentUserId: number,
  onEvent: (event: WebhookEvent) => Promise<void>,
  onWarning: (msg: string) => void,
) {
  const [webhookReady, setWebhookReady] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const ensureWebhookInbox = useCallback(async () => {
    const inboxUrl = buildApiUrl(`/hooks/inbox/${currentUserId}`);
    try {
      const hooks = await api.listWebhooks();
      const exists = hooks.some((hook) => hook.url === inboxUrl);
      if (!exists) {
        await api.createWebhook({
          url: inboxUrl,
          events: [
            'message.new',
            'message.pinned',
            'message.unpinned',
            'chat.pinned',
            'chat.unpinned',
            'presence.update',
          ],
        });
      }
      setWebhookReady(true);
    } catch (err) {
      if (err instanceof Error) {
        onWarning(`Не удалось настроить вебхуки: ${err.message}`);
      }
    }
  }, [currentUserId, onWarning]);

  useEffect(() => {
    ensureWebhookInbox();
  }, [ensureWebhookInbox]);

  useEffect(() => {
    if (!webhookReady) return;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const events = await api.pollInbox();
        for (const event of events) {
          await onEventRef.current(event);
        }
      } catch {
        // ignore transient errors
      }
    };

    poll();
    const intervalId = window.setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [webhookReady]);

  return { webhookReady };
}
