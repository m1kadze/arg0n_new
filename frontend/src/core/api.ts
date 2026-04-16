import type {
  ChatSummary,
  MessageOut,
  SearchResult,
  UserPublic,
  WebhookCreate,
  WebhookEvent,
  WebhookOut,
} from './types';

const AUTH_TOKEN_KEY = 'auth_token';

// Translation of backend HTTPException details → Russian
const ERROR_DICT: Record<string, string> = {
  'Invalid token': 'Недействительный токен',
  'User not found': 'Пользователь не найден',
  'Invalid credentials': 'Неверный логин или пароль',
  'Username already exists': 'Такой логин уже занят',
  'Chat not found': 'Чат не найден',
  'Message not found': 'Сообщение не найдено',
  'Participant not found': 'Участник не найден',
  'Webhook not found': 'Вебхук не найден',
  'Reply message not found': 'Исходное сообщение не найдено',
  'Forward author not found': 'Автор пересылаемого сообщения не найден',
  'Owner not found': 'Владелец не найден',
  'Only owner can post in channel': 'Публиковать в канал может только владелец',
  'Only owner can post in favorites': 'В избранное может писать только владелец',
  'You are blocked by this user': 'Этот пользователь вас заблокировал',
  'You blocked this user': 'Вы заблокировали этого пользователя',
  'Cannot block yourself': 'Нельзя заблокировать самого себя',
  'Cannot chat with yourself': 'Нельзя создать чат с самим собой',
  'Cannot edit this message': 'Это сообщение нельзя редактировать',
  'Cannot delete this message': 'Это сообщение нельзя удалить',
  'Cannot delete favorites': 'Нельзя удалить избранное',
  'Only text messages can be edited': 'Редактировать можно только текстовые сообщения',
  'Emoji is required': 'Укажите эмодзи',
  'Title is required': 'Укажите название',
  'Chat has no other participant': 'В чате нет других участников',
  'WebSocket endpoint. Use ws/wss with Upgrade headers.':
    'Это WebSocket-эндпоинт. Используйте ws/wss с Upgrade-заголовками.',
};

const translateError = (detail: string): string => {
  if (!detail) return detail;
  const trimmed = detail.trim();
  if (ERROR_DICT[trimmed]) return ERROR_DICT[trimmed];
  // fallback: try partial/case-insensitive match
  const lower = trimmed.toLowerCase();
  for (const [en, ru] of Object.entries(ERROR_DICT)) {
    if (lower === en.toLowerCase()) return ru;
  }
  return detail;
};

export const API_BASE_URL =
  (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ||
  '/api';

export const getAuthToken = (): string | null => {
  return localStorage.getItem(AUTH_TOKEN_KEY);
};

export const setAuthToken = (token: string | null): void => {
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }
};

export const buildApiUrl = (path: string): string => {
  if (path.startsWith('http')) {
    return path;
  }
  const base = API_BASE_URL.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
};

export const apiRequest = async <T>(
  path: string,
  options: RequestInit = {},
): Promise<T> => {
  const headers = new Headers(options.headers || {});
  const token = getAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const isForm = options.body instanceof FormData;
  if (!isForm && options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(buildApiUrl(path), {
    ...options,
    headers,
  });

  if (!response.ok) {
    const rawText = await response.text().catch(() => '');
    let detail = response.statusText;
    if (rawText) {
      try {
        const data = JSON.parse(rawText);
        if (typeof data.detail === 'string') {
          detail = data.detail;
        } else if (typeof data.detail === 'object') {
          detail = JSON.stringify(data.detail);
        } else {
          detail = rawText;
        }
      } catch {
        detail = rawText;
      }
    }
    throw new Error(translateError(detail));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  return (await response.text()) as T;
};

export const api = {
  getMe: async (): Promise<UserPublic> => apiRequest('/users/me'),
  searchUsers: async (query: string): Promise<SearchResult[]> =>
    apiRequest(`/users/search?q=${encodeURIComponent(query)}`),
  getChats: async (): Promise<ChatSummary[]> => apiRequest('/chats'),
  deleteChat: async (chatId: number): Promise<void> =>
    apiRequest(`/chats/${chatId}`, { method: 'DELETE' }),
  createChat: async (participantId: number): Promise<ChatSummary> =>
    apiRequest('/chats', {
      method: 'POST',
      body: JSON.stringify({ participant_id: participantId }),
    }),
  createGroup: async (title: string, memberIds: number[]): Promise<ChatSummary> =>
    apiRequest('/chats/groups', {
      method: 'POST',
      body: JSON.stringify({ title, member_ids: memberIds }),
    }),
  createChannel: async (title: string, memberIds: number[]): Promise<ChatSummary> =>
    apiRequest('/chats/channels', {
      method: 'POST',
      body: JSON.stringify({ title, member_ids: memberIds }),
    }),
  getMessages: async (chatId: number): Promise<MessageOut[]> =>
    apiRequest(`/chats/${chatId}/messages`),
  sendMessage: async (
    chatId: number,
    content: string,
    options: {
      reply_to_id?: number | null;
      forward_from_user_id?: number | null;
    } = {},
  ): Promise<MessageOut> =>
    apiRequest(`/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, ...options }),
    }),
  updateMessage: async (
    chatId: number,
    messageId: number,
    content: string,
  ): Promise<MessageOut> =>
    apiRequest(`/chats/${chatId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),
  toggleReaction: async (
    chatId: number,
    messageId: number,
    emoji: string,
  ): Promise<MessageOut> =>
    apiRequest(`/chats/${chatId}/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),
  deleteMessage: async (chatId: number, messageId: number): Promise<void> =>
    apiRequest(`/chats/${chatId}/messages/${messageId}`, { method: 'DELETE' }),
  pinMessage: async (chatId: number, messageId: number): Promise<MessageOut> =>
    apiRequest(`/chats/${chatId}/messages/${messageId}/pin`, {
      method: 'POST',
    }),
  unpinMessage: async (chatId: number, messageId: number): Promise<MessageOut> =>
    apiRequest(`/chats/${chatId}/messages/${messageId}/unpin`, {
      method: 'POST',
    }),
  getPinnedMessages: async (chatId: number): Promise<MessageOut[]> =>
    apiRequest(`/chats/${chatId}/pinned`),
  pinChat: async (chatId: number): Promise<void> =>
    apiRequest(`/chats/${chatId}/pin`, { method: 'POST' }),
  unpinChat: async (chatId: number): Promise<void> =>
    apiRequest(`/chats/${chatId}/unpin`, { method: 'POST' }),
  markRead: async (
    chatId: number,
    lastReadMessageId: number | null,
  ): Promise<void> => {
    await apiRequest(`/chats/${chatId}/read`, {
      method: 'POST',
      body: JSON.stringify({ last_read_message_id: lastReadMessageId }),
    });
  },
  sendAttachments: async (
    chatId: number,
    text: string | null,
    files: File[],
    options: {
      reply_to_id?: number | null;
      forward_from_user_id?: number | null;
    } = {},
  ): Promise<MessageOut> => {
    const form = new FormData();
    if (text) {
      form.append('text', text);
    }
    if (options.reply_to_id) {
      form.append('reply_to_id', String(options.reply_to_id));
    }
    if (options.forward_from_user_id) {
      form.append('forward_from_user_id', String(options.forward_from_user_id));
    }
    files.forEach((file) => form.append('files', file));
    return apiRequest(`/chats/${chatId}/messages/attachments`, {
      method: 'POST',
      body: form,
    });
  },
  listWebhooks: async (): Promise<WebhookOut[]> => apiRequest('/webhooks'),
  createWebhook: async (payload: WebhookCreate): Promise<WebhookOut> =>
    apiRequest('/webhooks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  pollInbox: async (): Promise<WebhookEvent[]> => apiRequest('/hooks/inbox'),
  pingPresence: async (): Promise<void> => {
    await apiRequest('/presence/ping', { method: 'POST' });
  },
  offlinePresence: async (): Promise<void> => {
    await apiRequest('/presence/offline', { method: 'POST' });
  },
  updateProfile: async (
    display_name: string | null,
    about: string | null,
    avatar: File | null,
    remove_avatar: boolean,
  ): Promise<UserPublic> => {
    const form = new FormData();
    if (display_name !== null) {
      form.append('display_name', display_name);
    }
    if (about !== null) {
      form.append('about', about);
    }
    if (avatar) {
      form.append('avatar', avatar);
    }
    if (remove_avatar) {
      form.append('remove_avatar', 'true');
    }
    return apiRequest('/users/me', {
      method: 'PATCH',
      body: form,
    });
  },
  getBlockedUsers: async (): Promise<number[]> => apiRequest('/users/blocks'),
  blockUser: async (userId: number): Promise<void> =>
    apiRequest(`/users/${userId}/block`, { method: 'POST' }),
  unblockUser: async (userId: number): Promise<void> =>
    apiRequest(`/users/${userId}/block`, { method: 'DELETE' }),
};
