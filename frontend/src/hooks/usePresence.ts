import { useCallback, useEffect, useState } from 'react';
import { buildApiUrl, getAuthToken } from '../core/api';
import type { ChatSummary, WebhookEvent } from '../core/types';

export type PresenceState = {
  is_online: boolean;
  last_seen_at?: string | null;
};

export function usePresence(
  setChats: React.Dispatch<React.SetStateAction<ChatSummary[]>>,
) {
  const [presenceMap, setPresenceMap] = useState<Record<number, PresenceState>>({});

  // Offline on unload (fallback — WebSocket disconnect also handles this on backend)
  useEffect(() => {
    const handleBeforeUnload = () => {
      const token = getAuthToken();
      if (!token) return;
      void fetch(buildApiUrl('/presence/offline'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
      });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const handlePresenceEvent = useCallback(
    (event: WebhookEvent) => {
      const userId = Number(event.data.user_id);
      if (!Number.isFinite(userId)) return;

      const isOnline = Boolean(event.data.is_online);
      const lastSeen =
        typeof event.data.last_seen_at === 'string'
          ? event.data.last_seen_at
          : null;

      setPresenceMap((prev) => ({
        ...prev,
        [userId]: {
          is_online: isOnline,
          last_seen_at: lastSeen ?? prev[userId]?.last_seen_at,
        },
      }));

      setChats((prev) =>
        prev.map((chat) =>
          chat.participant && chat.participant.id === userId
            ? {
                ...chat,
                participant: {
                  ...chat.participant,
                  is_online: isOnline,
                  last_seen_at: lastSeen ?? chat.participant.last_seen_at,
                },
              }
            : chat,
        ),
      );
    },
    [setChats],
  );

  return { presenceMap, handlePresenceEvent };
}
