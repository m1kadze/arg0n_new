import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../core/api';
import type { MessageOut } from '../core/types';

export function useMessages(
  selectedChatId: number | null,
  currentUserId: number,
  onError: (msg: string) => void,
) {
  const [messages, setMessages] = useState<MessageOut[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<MessageOut[]>([]);

  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);

  const markChatRead = useCallback(
    async (chatId: number, items: MessageOut[]) => {
      const lastIncoming = [...items]
        .reverse()
        .find((msg) => msg.sender_id !== currentUserId);
      if (!lastIncoming) return;
      try {
        await api.markRead(chatId, lastIncoming.id);
      } catch {
        // ignore
      }
    },
    [currentUserId],
  );

  const loadMessages = useCallback(
    async (chatId: number, markReadFlag = true) => {
      try {
        setLoadingMessages(true);
        const data = await api.getMessages(chatId);
        setMessages(data);
        if (markReadFlag) {
          await markChatRead(chatId, data);
        }
      } catch (err) {
        if (err instanceof Error) onError(err.message);
      } finally {
        setLoadingMessages(false);
      }
    },
    [markChatRead, onError],
  );

  const loadPinned = useCallback(async (chatId: number) => {
    try {
      const items = await api.getPinnedMessages(chatId);
      setPinnedMessages(items);
    } catch {
      setPinnedMessages([]);
    }
  }, []);

  useEffect(() => {
    if (selectedChatId !== null) {
      loadMessages(selectedChatId);
      loadPinned(selectedChatId);
    } else {
      setPinnedMessages([]);
    }
  }, [selectedChatId, loadMessages, loadPinned]);

  // Auto-scroll to latest message
  useEffect(() => {
    const container = chatMessagesRef.current;
    if (!container) return;
    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distance < 200) {
      scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const messageMap = useMemo(() => {
    const map = new Map<number, MessageOut>();
    messages.forEach((msg) => map.set(msg.id, msg));
    return map;
  }, [messages]);

  return {
    messages,
    setMessages,
    loadingMessages,
    loadMessages,
    pinnedMessages,
    setPinnedMessages,
    loadPinned,
    scrollAnchorRef,
    chatMessagesRef,
    messageMap,
  };
}
