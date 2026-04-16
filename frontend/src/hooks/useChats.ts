import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../core/api';
import type { ChatSummary } from '../core/types';

const CHAT_QUERY_KEY = 'chat';

const parseChatIdFromLocation = (): number | null => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get(CHAT_QUERY_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const updateChatUrl = (chatId: number | null) => {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (chatId) {
    url.searchParams.set(CHAT_QUERY_KEY, String(chatId));
  } else {
    url.searchParams.delete(CHAT_QUERY_KEY);
  }
  window.history.replaceState({}, '', url);
};

export function useChats(onError: (msg: string) => void) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [loadingChats, setLoadingChats] = useState(true);

  const selectedChatIdRef = useRef<number | null>(null);
  const initialChatIdRef = useRef<number | null>(parseChatIdFromLocation());

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => {
    if (selectedChatId === null) {
      if (!initialChatIdRef.current) {
        updateChatUrl(null);
      }
      return;
    }
    updateChatUrl(selectedChatId);
  }, [selectedChatId]);

  const loadChats = useCallback(async () => {
    try {
      setLoadingChats(true);
      const data = await api.getChats();
      setChats(data);
      if (!selectedChatIdRef.current && data.length > 0) {
        const initialChatId = initialChatIdRef.current;
        const match = initialChatId
          ? data.find((item) => item.id === initialChatId)
          : null;
        if (match) {
          setSelectedChatId(match.id);
        } else {
          setSelectedChatId(data[0].id);
        }
      }
    } catch (err) {
      if (err instanceof Error) onError(err.message);
    } finally {
      setLoadingChats(false);
    }
  }, [onError]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  const sortedChats = useMemo(() => {
    return [...chats].sort((a, b) => {
      const aPinned = Boolean(a.is_pinned);
      const bPinned = Boolean(b.is_pinned);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;

      const aFav = a.chat_type === 'favorites';
      const bFav = b.chat_type === 'favorites';
      if (aFav !== bFav) return aFav ? -1 : 1;

      const aTime = a.last_message?.created_at || '';
      const bTime = b.last_message?.created_at || '';
      return bTime.localeCompare(aTime);
    });
  }, [chats]);

  const selectedChat = chats.find((chat) => chat.id === selectedChatId) || null;

  return {
    chats,
    setChats,
    selectedChatId,
    setSelectedChatId,
    selectedChatIdRef,
    selectedChat,
    loadingChats,
    loadChats,
    sortedChats,
  };
}
