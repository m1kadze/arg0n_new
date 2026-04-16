import { useCallback } from 'react';
import type { ChatSummary } from '../core/types';

const isDirectChat = (chat: ChatSummary | null | undefined): boolean => {
  return chat?.chat_type === 'direct';
};

export function useMessageValidation(
  selectedChatId: number | null,
  selectedChat: ChatSummary | null,
  currentUserId: number,
  blockedUserIds: number[],
  onInfo: (msg: string) => void,
  onWarning: (msg: string) => void,
) {
  const isReadonlyChannel =
    selectedChat?.chat_type === 'channel' &&
    selectedChat.owner_id !== undefined &&
    selectedChat.owner_id !== currentUserId;

  const blockedByOther =
    Boolean(selectedChat?.blocked_by_other) &&
    Boolean(selectedChat && isDirectChat(selectedChat));

  const isBlocked =
    selectedChat && isDirectChat(selectedChat) && selectedChat.participant
      ? blockedUserIds.includes(selectedChat.participant.id)
      : false;

  const composerDisabled = isBlocked || Boolean(isReadonlyChannel) || blockedByOther;

  const validateMessageAction = useCallback((): boolean => {
    if (!selectedChatId) {
      onInfo('Выберите чат для отправки сообщения.');
      return false;
    }
    if (isReadonlyChannel) {
      onWarning('Только владелец может писать в канал.');
      return false;
    }
    if (blockedByOther) {
      onWarning('Пользователь запретил отправку сообщений.');
      return false;
    }
    if (
      selectedChat &&
      isDirectChat(selectedChat) &&
      selectedChat.participant &&
      blockedUserIds.includes(selectedChat.participant.id)
    ) {
      onWarning('Пользователь заблокирован.');
      return false;
    }
    return true;
  }, [selectedChatId, isReadonlyChannel, blockedByOther, selectedChat, blockedUserIds, onInfo, onWarning]);

  return {
    isReadonlyChannel,
    blockedByOther,
    isBlocked,
    composerDisabled,
    validateMessageAction,
  };
}
