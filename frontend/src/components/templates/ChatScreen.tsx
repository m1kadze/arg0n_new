
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as AntdApp, Button, Drawer, Input, Modal, Spin } from 'antd';
import {
  Ban,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Eye,
  LogOut,
  Menu,
  Mic,
  Paperclip,
  Pin,
  Phone,
  PhoneOff,
  Search,
  Smile,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import sendIcon from '../../assets/icons/send2.svg';
import { api, buildApiUrl } from '../../core/api';
import type {
  AttachmentOut,
  ChatSummary,
  MessageOut,
  SearchResult,
  UserPublic,
  WebhookEvent,
} from '../../core/types';
import { AudioPlayer } from '../ui/AudioPlayer';
import { RecordingBar } from '../ui/RecordingBar';
import {
  useChats,
  useMessages,
  usePresence,
  useRealtimeSocket,
  useCalls,
  useEmojiPanel,
  useMessageValidation,
} from '../../hooks';
import type { EmojiEntry } from '../../hooks';

const REACTION_SET = ['👍', '❤️', '😂', '🔥', '😮', '👎'];
const BLOCKED_USERS_KEY = 'tg_blocked_users';

type MediaItem = {
  type: 'image' | 'video';
  url: string;
  title: string;
};

type ViewerState = {
  items: MediaItem[];
  index: number;
};

type ProfileDraftState = {
  displayName: string;
  about: string;
  avatarFile: File | null;
  avatarPreview: string;
  removeAvatar: boolean;
};

type ProfileView = {
  displayName: string;
  about: string;
  avatarUrl?: string | null;
};

type MessageMenuState = {
  message: MessageOut;
  x: number;
  y: number;
};

type ChatMenuState = {
  chat: ChatSummary;
  x: number;
  y: number;
};

type MediaBucket = {
  photos: AttachmentOut[];
  videos: AttachmentOut[];
  audio: AttachmentOut[];
  documents: AttachmentOut[];
};

interface ChatScreenProps {
  currentUser: UserPublic;
  onLogout: () => void;
  onProfileUpdated: (user: UserPublic) => void;
}

const readStorage = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeStorage = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
};

const hasTimezone = (value: string): boolean => {
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(value);
};

const parseTimestamp = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const normalized = hasTimezone(value) ? value : `${value}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const formatTime = (value: string): string => {
  const date = parseTimestamp(value);
  if (!date) return '';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

const formatLastSeen = (value?: string | null): string => {
  const date = parseTimestamp(value || null);
  if (!date) return 'был(а) в сети недавно';
  return `был(а) в сети ${date.toLocaleString('ru-RU')}`;
};

const getReplyPreview = (message: MessageOut | null | undefined): string => {
  if (!message) return 'Сообщение недоступно';
  if (message.content) return message.content;
  if (message.message_type !== 'text' || message.attachments.length > 0) {
    const first = message.attachments[0];
    if (first?.media_kind === 'image') return 'Фото';
    if (first?.media_kind === 'video') return 'Видео';
    if (first?.media_kind === 'audio') return 'Голосовое сообщение';
    if (first) return 'Файл';
    return 'Вложение';
  }
  return 'Сообщение';
};

const getInitial = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
};

const avatarPalette = [
  '#ff8a65', '#4db6ac', '#9575cd', '#64b5f6',
  '#ffd54f', '#f06292', '#81c784', '#ba68c8',
];

const getAvatarColor = (seed: number): string => {
  return avatarPalette[Math.abs(seed) % avatarPalette.length];
};

const resolveAvatarUrl = (value?: string | null): string => {
  if (!value) return '';
  if (value.startsWith('data:')) return value;
  return buildApiUrl(value);
};

const getFileIcon = (fileName: string): { label: string; className: string } => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (['doc', 'docx'].includes(ext)) return { label: 'DOC', className: 'file-icon-word' };
  if (['xls', 'xlsx'].includes(ext)) return { label: 'XLS', className: 'file-icon-excel' };
  if (['ppt', 'pptx'].includes(ext)) return { label: 'PPT', className: 'file-icon-ppt' };
  if (ext === 'pdf') return { label: 'PDF', className: 'file-icon-pdf' };
  if (ext) return { label: ext.toUpperCase(), className: 'file-icon-generic' };
  return { label: 'FILE', className: 'file-icon-generic' };
};

const isDirectChat = (chat: ChatSummary | null | undefined): boolean => {
  return chat?.chat_type === 'direct';
};

const getChatTitle = (chat: ChatSummary): string => {
  if (chat.chat_type === 'direct') {
    return chat.participant?.display_name || chat.participant?.username || 'Чат';
  }
  if (chat.chat_type === 'favorites') return chat.title || 'Избранное';
  return chat.title || 'Без названия';
};

const getChatSubtitle = (chat: ChatSummary): string => {
  if (chat.chat_type === 'group') return `Группа · ${chat.participants_count ?? 0} участников`;
  if (chat.chat_type === 'channel') return `Канал · ${chat.participants_count ?? 0} подписчиков`;
  if (chat.chat_type === 'favorites') return 'Личные сообщения';
  if (chat.participant?.username) return `@${chat.participant.username}`;
  return '';
};

const getChatAvatarSeed = (chat: ChatSummary): number => {
  if (chat.chat_type === 'direct') return chat.participant?.id || chat.id;
  return chat.id;
};

export const ChatScreen: React.FC<ChatScreenProps> = ({
  currentUser,
  onLogout,
  onProfileUpdated,
}) => {
  const { message } = AntdApp.useApp();

  const onError = useCallback((msg: string) => message.error(msg), [message]);
  const onWarning = useCallback((msg: string) => message.warning(msg), [message]);
  const onInfo = useCallback((msg: string) => message.info(msg), [message]);

  // --- Hooks ---
  const {
    chats, setChats, selectedChatId, setSelectedChatId,
    selectedChatIdRef, selectedChat, loadingChats, loadChats, sortedChats,
  } = useChats(onError);

  const {
    messages, setMessages, loadingMessages, loadMessages,
    pinnedMessages, setPinnedMessages, loadPinned,
    scrollAnchorRef, chatMessagesRef, messageMap,
  } = useMessages(selectedChatId, currentUser.id, onError);

  const { presenceMap, handlePresenceEvent } = usePresence(setChats);

  const {
    emojiOpen, setEmojiOpen, emojiCategory, emojiSearch, setEmojiSearch,
    emojiSearchValue, emojiLoading, emojiCategories, currentEmojiList,
    emojiMap, emojiCategoryRefs, emojiCategoryScrollRef,
    handleCategoryMouseDown, handleCategoryMouseUp, handleEmojiCategoryClick,
    buildEmojiParts, extractEmojisFromText, isEmojiOnlyText, addRecentEmojis,
  } = useEmojiPanel();

  const {
    blockedByOther, isBlocked, composerDisabled,
    validateMessageAction,
  } = useMessageValidation(
    selectedChatId, selectedChat, currentUser.id,
    readStorage<number[]>(BLOCKED_USERS_KEY, []),
    onInfo, onWarning,
  );

  const {
    callModalOpen, callType, callActive, callMuted,
    callCameraOff, callElapsed, incomingCall,
    localVideoRef, remoteVideoRef, remoteAudioRef,
    startCall, acceptCall, declineCall, handleToggleMute,
    handleToggleCamera, teardownCall, formatCallTime,
  } = useCalls(selectedChatId, onInfo, onError);

  // --- Local state ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [composerText, setComposerText] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  // RecordingBar tracks elapsed time internally; we just keep a boolean here.
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [viewerZoom, setViewerZoom] = useState(1);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [previewItems, setPreviewItems] = useState<
    Array<{ file: File; url: string; kind: string }>
  >([]);
  const [messageMenu, setMessageMenu] = useState<MessageMenuState | null>(null);
  const [chatMenu, setChatMenu] = useState<ChatMenuState | null>(null);
  const [replyTo, setReplyTo] = useState<MessageOut | null>(null);
  const [forwardModalOpen, setForwardModalOpen] = useState(false);
  const [forwardMessage, setForwardMessage] = useState<MessageOut | null>(null);
  const [forwardChatId, setForwardChatId] = useState<number | null>(null);
  const [forwardSending, setForwardSending] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState<ProfileDraftState>({
    displayName: currentUser.display_name || currentUser.username,
    about: currentUser.about || '',
    avatarFile: null,
    avatarPreview: '',
    removeAvatar: false,
  });
  const [blockedUserIds, setBlockedUserIds] = useState<number[]>(
    readStorage<number[]>(BLOCKED_USERS_KEY, []),
  );
  const [sideTab, setSideTab] = useState<'photos' | 'videos' | 'audio' | 'documents'>('photos');
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createChatType, setCreateChatType] = useState<'group' | 'channel'>('group');
  const [createTitle, setCreateTitle] = useState('');
  const [createQuery, setCreateQuery] = useState('');
  const [createResults, setCreateResults] = useState<SearchResult[]>([]);
  const [createMembers, setCreateMembers] = useState<SearchResult[]>([]);
  const [createLoading, setCreateLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingCancelledRef = useRef<boolean>(false);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const profileAvatarInputRef = useRef<HTMLInputElement | null>(null);

  // --- Webhook event handling ---
  const handleNewMessageEvent = useCallback(
    async (event: WebhookEvent) => {
      const chatId = Number(event.data.chat_id);
      if (!Number.isFinite(chatId)) return;
      await loadChats();
      if (selectedChatIdRef.current === chatId) {
        await loadMessages(chatId);
      }
    },
    [loadChats, loadMessages, selectedChatIdRef],
  );

  const handlePinnedMessageEvent = useCallback(
    async (event: WebhookEvent) => {
      const chatId = Number(event.data.chat_id);
      if (!Number.isFinite(chatId)) return;
      await loadChats();
      if (selectedChatIdRef.current === chatId) {
        await loadPinned(chatId);
      }
    },
    [loadChats, loadPinned, selectedChatIdRef],
  );

  const handleChatPinEvent = useCallback(async () => {
    await loadChats();
  }, [loadChats]);

  const handleWebhookEvent = useCallback(
    async (event: WebhookEvent) => {
      switch (event.event) {
        case 'presence.update':
          handlePresenceEvent(event);
          break;
        case 'message.new':
          await handleNewMessageEvent(event);
          break;
        case 'message.pinned':
        case 'message.unpinned':
          await handlePinnedMessageEvent(event);
          break;
        case 'chat.pinned':
        case 'chat.unpinned':
          await handleChatPinEvent();
          break;
      }
    },
    [handlePresenceEvent, handleNewMessageEvent, handlePinnedMessageEvent, handleChatPinEvent],
  );

  useRealtimeSocket(handleWebhookEvent);

  // --- Effects ---
  useEffect(() => {
    writeStorage(BLOCKED_USERS_KEY, blockedUserIds);
  }, [blockedUserIds]);

  useEffect(() => {
    const previews = attachments.map((file) => {
      const url = URL.createObjectURL(file);
      const type = file.type || '';
      const kind = type.startsWith('image/')
        ? 'image'
        : type.startsWith('video/')
          ? 'video'
          : type.startsWith('audio/')
            ? 'audio'
            : 'file';
      return { file, url, kind };
    });
    setPreviewItems(previews);
    return () => {
      previews.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, [attachments]);

  useEffect(() => {
    if (!messageMenu && !chatMenu && !emojiOpen) return;
    const handleClick = () => {
      setMessageMenu(null);
      setChatMenu(null);
      setEmojiOpen(false);
    };
    window.addEventListener('click', handleClick);
    window.addEventListener('contextmenu', handleClick);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('contextmenu', handleClick);
    };
  }, [messageMenu, chatMenu, emojiOpen, setEmojiOpen]);

  useEffect(() => {
    const loadBlocks = async () => {
      try {
        const ids = await api.getBlockedUsers();
        setBlockedUserIds(ids);
      } catch (err) {
        if (err instanceof Error) message.error(err.message);
      }
    };
    loadBlocks();
  }, []);

  useEffect(() => {
    setReplyTo(null);
  }, [selectedChatId]);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      try {
        const results = await api.searchUsers(trimmed);
        setSearchResults(
          results.filter(
            (item) => item.id !== currentUser.id && !blockedUserIds.includes(item.id),
          ),
        );
      } catch (err) {
        if (err instanceof Error) message.error(err.message);
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchQuery, currentUser.id, blockedUserIds]);

  useEffect(() => {
    if (!createModalOpen) {
      setCreateResults([]);
      return;
    }
    const trimmed = createQuery.trim();
    if (trimmed.length < 2) {
      setCreateResults([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      try {
        const results = await api.searchUsers(trimmed);
        const existingIds = new Set(createMembers.map((item) => item.id));
        setCreateResults(
          results.filter(
            (item) =>
              item.id !== currentUser.id &&
              !blockedUserIds.includes(item.id) &&
              !existingIds.has(item.id),
          ),
        );
      } catch (err) {
        if (err instanceof Error) message.error(err.message);
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [createQuery, createMembers, createModalOpen, currentUser.id, blockedUserIds]);

  // --- Computed values ---
  const mediaByType = useMemo<MediaBucket>(() => {
    return messages.reduce<MediaBucket>(
      (acc, msg) => {
        msg.attachments.forEach((attachment) => {
          if (attachment.media_kind === 'image') acc.photos.push(attachment);
          else if (attachment.media_kind === 'video') acc.videos.push(attachment);
          else if (attachment.media_kind === 'audio') acc.audio.push(attachment);
          else acc.documents.push(attachment);
        });
        return acc;
      },
      { photos: [], videos: [], audio: [], documents: [] },
    );
  }, [messages]);

  const incomingChat = incomingCall
    ? chats.find((chat) => chat.id === incomingCall.chatId) || null
    : null;

  const userNameMap = useMemo(() => {
    const map = new Map<number, string>();
    map.set(currentUser.id, currentUser.display_name || currentUser.username);
    chats.forEach((chat) => {
      if (chat.participant) {
        map.set(chat.participant.id, chat.participant.display_name || chat.participant.username);
      }
    });
    return map;
  }, [currentUser.id, currentUser.display_name, currentUser.username, chats]);

  const resolveUserName = (userId?: number | null): string => {
    if (!userId) return 'Пользователь';
    return userNameMap.get(userId) || `Пользователь ${userId}`;
  };

  const messageMenuReactions =
    messageMenu?.message?.id
      ? messageMap.get(messageMenu.message.id)?.reactions ||
        messageMenu.message.reactions || {}
      : {};

  const composerHasContent = composerText.trim().length > 0 || attachments.length > 0;

  // --- Message list virtualizer ---
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => chatMessagesRef.current,
    estimateSize: () => 80,
    overscan: 10,
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length === 0) return;
    const container = chatMessagesRef.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distance < 200) {
      rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end', behavior: 'smooth' });
    }
  }, [messages.length, rowVirtualizer]);

  const selectedPresence =
    selectedChat && isDirectChat(selectedChat) && selectedChat.participant
      ? presenceMap[selectedChat.participant.id]
      : null;

  const selectedProfile: ProfileView | null =
    selectedChat && isDirectChat(selectedChat) && selectedChat.participant
      ? {
          displayName: selectedChat.participant.display_name || selectedChat.participant.username,
          about: selectedChat.participant.about || '',
          avatarUrl: resolveAvatarUrl(selectedChat.participant.avatar_url),
        }
      : null;

  const selectedChatPinned = Boolean(selectedChat?.is_pinned);

  const activeProfileAvatar =
    profileDraft.removeAvatar
      ? ''
      : profileDraft.avatarPreview || resolveAvatarUrl(currentUser.avatar_url) || '';
  const showRemoveAvatarButton =
    Boolean(profileDraft.avatarPreview) ||
    Boolean(currentUser.avatar_url && !profileDraft.removeAvatar);

  // --- Handlers ---
  const handleSelectChat = (chatId: number) => {
    setSelectedChatId(chatId);
  };

  const handleStartChat = async (userId: number) => {
    if (blockedUserIds.includes(userId)) {
      message.warning('Пользователь заблокирован.');
      return;
    }
    try {
      const chat = await api.createChat(userId);
      setChats((prev) => {
        const exists = prev.some((item) => item.id === chat.id);
        return exists ? prev : [chat, ...prev];
      });
      setSelectedChatId(chat.id);
      setSearchQuery('');
      setSearchResults([]);
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    }
  };

  const openCreateModal = (type: 'group' | 'channel') => {
    setCreateChatType(type);
    setCreateTitle('');
    setCreateQuery('');
    setCreateMembers([]);
    setCreateResults([]);
    setCreateModalOpen(true);
    setMenuOpen(false);
  };

  const handleCreateAddMember = (item: SearchResult) => {
    setCreateMembers((prev) => [...prev, item]);
    setCreateQuery('');
    setCreateResults([]);
  };

  const handleCreateRemoveMember = (userId: number) => {
    setCreateMembers((prev) => prev.filter((member) => member.id !== userId));
  };

  const handleCreateSubmit = async () => {
    const title = createTitle.trim();
    if (!title) {
      message.warning('Введите название.');
      return;
    }
    try {
      setCreateLoading(true);
      const memberIds = createMembers.map((member) => member.id);
      const chat =
        createChatType === 'group'
          ? await api.createGroup(title, memberIds)
          : await api.createChannel(title, memberIds);
      setChats((prev) => {
        const exists = prev.some((item) => item.id === chat.id);
        return exists ? prev : [chat, ...prev];
      });
      setSelectedChatId(chat.id);
      setCreateModalOpen(false);
      setCreateMembers([]);
      setCreateQuery('');
      setCreateResults([]);
      setCreateTitle('');
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    } finally {
      setCreateLoading(false);
    }
  };

  const handleFilesPicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) setAttachments((prev) => [...prev, ...files]);
    event.target.value = '';
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== index));
  };

  const sendTextMessage = async (
    replyToId: number | null = null,
    forwardFromUserId: number | null = null,
  ) => {
    const textToSend = composerText.trim();
    if (!selectedChatId || !textToSend) return;
    try {
      setSending(true);
      const msg = await api.sendMessage(selectedChatId, textToSend, {
        reply_to_id: replyToId,
        forward_from_user_id: forwardFromUserId,
      });
      setMessages((prev) => [...prev, msg]);
      setComposerText('');
      setReplyTo(null);
      addRecentEmojis(extractEmojisFromText(textToSend));
      await loadChats();
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    } finally {
      setSending(false);
    }
  };

  const sendAttachmentsHandler = async (
    files: File[],
    text: string | null,
    replyToId: number | null = null,
    forwardFromUserId: number | null = null,
  ) => {
    if (!selectedChatId || files.length === 0) return;
    try {
      setSending(true);
      const msg = await api.sendAttachments(selectedChatId, text, files, {
        reply_to_id: replyToId,
        forward_from_user_id: forwardFromUserId,
      });
      setMessages((prev) => [...prev, msg]);
      setComposerText('');
      setAttachments([]);
      setReplyTo(null);
      if (text) addRecentEmojis(extractEmojisFromText(text));
      await loadChats();
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    if (!validateMessageAction()) return;
    const replyToId = replyTo?.id ?? null;
    if (attachments.length > 0) {
      await sendAttachmentsHandler(attachments, composerText.trim() || null, replyToId);
      return;
    }
    await sendTextMessage(replyToId);
  };

  const startRecording = async () => {
    if (!validateMessageAction()) return;

    if (!window.isSecureContext) {
      message.error('Запись аудио доступна только по HTTPS или localhost.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      message.error('Запись аудио не поддерживается в этом браузере.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      message.error('Запись аудио не поддерживается в этом браузере.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeCandidates = [
        'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus',
        'audio/ogg', 'audio/mp4', 'audio/mpeg',
      ];
      const mimeType =
        mimeCandidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordedChunksRef.current = [];
      recordingCancelledRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        try {
          if (recordingCancelledRef.current) return;
          if (recordedChunksRef.current.length === 0) return;
          const resolvedType = recorder.mimeType || mimeType || 'audio/webm';
          const blob = new Blob(recordedChunksRef.current, { type: resolvedType });
          const ext = resolvedType.includes('mp4')
            ? 'm4a'
            : resolvedType.includes('mpeg')
              ? 'mp3'
              : resolvedType.includes('ogg')
                ? 'ogg'
                : 'webm';
          const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: resolvedType });
          await sendAttachmentsHandler([file], null);
        } finally {
          stream.getTracks().forEach((track) => track.stop());
          recordingStreamRef.current = null;
          setRecordingStream(null);
        }
      };

      recorderRef.current = recorder;
      recordingStreamRef.current = stream;
      setRecordingStream(stream);
      recorder.start();
      setRecording(true);
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    }
  };

  const stopRecording = () => {
    if (recorderRef.current) {
      recordingCancelledRef.current = false;
      recorderRef.current.stop();
      recorderRef.current = null;
      setRecording(false);
    }
  };

  const cancelRecording = () => {
    if (recorderRef.current) {
      recordingCancelledRef.current = true;
      try {
        recorderRef.current.stop();
      } catch {
        /* noop */
      }
      recorderRef.current = null;
    }
    recordedChunksRef.current = [];
    setRecording(false);
  };

  const handleLogout = async () => {
    try {
      await api.offlinePresence();
    } catch {
      // ignore
    }
    onLogout();
  };

  const openViewer = (items: MediaItem[], index: number) => {
    setViewer({ items, index });
    setViewerZoom(1);
  };

  const closeViewer = () => {
    setViewer(null);
    setViewerZoom(1);
  };

  const handleViewerPrev = () => {
    if (!viewer) return;
    setViewer({ ...viewer, index: (viewer.index - 1 + viewer.items.length) % viewer.items.length });
    setViewerZoom(1);
  };

  const handleViewerNext = () => {
    if (!viewer) return;
    setViewer({ ...viewer, index: (viewer.index + 1) % viewer.items.length });
    setViewerZoom(1);
  };

  const handleViewerWheel = (event: React.WheelEvent) => {
    if (!viewer || viewer.items[viewer.index].type !== 'image') return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.deltaY > 0 ? -1 : 1;
    const step = 0.1;
    setViewerZoom((prev) =>
      Math.min(3, Math.max(0.5, Number((prev + direction * step).toFixed(2)))),
    );
  };

  const buildMediaItems = (items: AttachmentOut[]): MediaItem[] => {
    return items
      .filter((attachment) => ['image', 'video'].includes(attachment.media_kind))
      .map((attachment) => ({
        type: attachment.media_kind === 'video' ? 'video' : 'image',
        url: buildApiUrl(attachment.url),
        title: attachment.file_name,
      }));
  };

  const handleEditMessage = (msg: MessageOut) => {
    if (msg.sender_id !== currentUser.id) return;
    setEditingMessageId(msg.id);
    setEditingText(msg.content || '');
    setMessageMenu(null);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingText('');
  };

  const handleSaveEdit = async (messageId: number) => {
    if (!selectedChatId) return;
    const trimmed = editingText.trim();
    if (!trimmed) {
      message.error('Сообщение не может быть пустым.');
      return;
    }
    try {
      const updated = await api.updateMessage(selectedChatId, messageId, trimmed);
      setMessages((prev) => prev.map((item) => (item.id === messageId ? updated : item)));
      setPinnedMessages((prev) => prev.map((item) => (item.id === messageId ? updated : item)));
      handleCancelEdit();
      await loadChats();
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    }
  };

  const handleDeleteMessage = async (messageId: number) => {
    if (!selectedChatId) return;
    if (!window.confirm('Удалить сообщение?')) return;
    try {
      await api.deleteMessage(selectedChatId, messageId);
      setMessages((prev) => prev.filter((item) => item.id !== messageId));
      setPinnedMessages((prev) => prev.filter((item) => item.id !== messageId));
      await loadChats();
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    }
  };

  const handleTogglePin = async (msg: MessageOut) => {
    if (!selectedChatId) return;
    try {
      const updated = msg.is_pinned
        ? await api.unpinMessage(selectedChatId, msg.id)
        : await api.pinMessage(selectedChatId, msg.id);
      setMessages((prev) => prev.map((item) => (item.id === msg.id ? updated : item)));
      await loadPinned(selectedChatId);
      setMessageMenu(null);
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    }
  };

  const handleScrollToMessage = (messageId: number) => {
    const element = document.getElementById(`message-${messageId}`);
    if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const toggleReaction = async (messageId: number, emoji: string) => {
    if (!selectedChatId) return;
    try {
      const updated = await api.toggleReaction(selectedChatId, messageId, emoji);
      setMessages((prev) => prev.map((item) => (item.id === messageId ? updated : item)));
      setPinnedMessages((prev) => prev.map((item) => (item.id === messageId ? updated : item)));
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    }
    setMessageMenu(null);
  };

  const handleReplyMessage = (msg: MessageOut) => {
    setReplyTo(msg);
    setMessageMenu(null);
  };

  const handleForwardMessage = (msg: MessageOut) => {
    setForwardMessage(msg);
    setForwardChatId(null);
    setForwardModalOpen(true);
    setMessageMenu(null);
  };

  const fetchForwardFiles = async (atts: AttachmentOut[]): Promise<File[]> => {
    const files = await Promise.all(
      atts.map(async (attachment) => {
        const response = await fetch(buildApiUrl(attachment.url));
        if (!response.ok) throw new Error('Не удалось загрузить вложение для пересылки.');
        const blob = await response.blob();
        const type = attachment.content_type || blob.type || 'application/octet-stream';
        return new File([blob], attachment.file_name, { type });
      }),
    );
    return files;
  };

  const handleForwardSend = async () => {
    if (!forwardMessage || !forwardChatId) return;
    try {
      setForwardSending(true);
      const forwardFromUserId = forwardMessage.sender_id || null;
      if (forwardMessage.attachments.length > 0) {
        const files = await fetchForwardFiles(forwardMessage.attachments);
        await api.sendAttachments(forwardChatId, forwardMessage.content, files, {
          forward_from_user_id: forwardFromUserId,
        });
      } else if (forwardMessage.content) {
        await api.sendMessage(forwardChatId, forwardMessage.content, {
          forward_from_user_id: forwardFromUserId,
        });
      } else {
        await api.sendMessage(forwardChatId, 'Вложение', {
          forward_from_user_id: forwardFromUserId,
        });
      }
      message.success('Сообщение переслано.');
      setForwardModalOpen(false);
      setForwardMessage(null);
      setForwardChatId(null);
      await loadChats();
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
      else message.error('Не удалось переслать сообщение.');
    } finally {
      setForwardSending(false);
    }
  };

  const handleMessageContext = (event: React.MouseEvent, msg: MessageOut) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 200;
    const menuHeight = 260;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - 8);
    setMessageMenu({ message: msg, x, y });
    setChatMenu(null);
  };

  const handleChatContext = (event: React.MouseEvent, chat: ChatSummary) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 220;
    const menuHeight = 160;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - 8);
    setChatMenu({ chat, x, y });
    setMessageMenu(null);
  };

  const handleCopyMessage = async (msg: MessageOut) => {
    const imageAttachment = msg.attachments.find((item) => item.media_kind === 'image');
    const textValue = msg.content?.trim() || '';
    const fallback = msg.attachments.length
      ? msg.attachments.map((item) => buildApiUrl(item.url)).join('\n')
      : '';
    const text = textValue || fallback || 'Вложение';
    const copyText = async (value: string): Promise<boolean> => {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const successful = document.execCommand?.('copy') ?? false;
      document.body.removeChild(textarea);
      return successful;
    };
    const copyImage = async (url: string): Promise<boolean> => {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
      const response = await fetch(url);
      if (!response.ok) return false;
      const blob = await response.blob();
      const mimeType = blob.type || 'image/png';
      await navigator.clipboard.write([new ClipboardItem({ [mimeType]: blob })]);
      return true;
    };
    try {
      if (!textValue && imageAttachment) {
        const imageUrl = buildApiUrl(imageAttachment.url);
        const copied = await copyImage(imageUrl);
        if (copied) {
          message.success('Фото скопировано в буфер обмена.');
          return;
        }
      }
      const ok = await copyText(text);
      if (!ok) throw new Error('Не удалось скопировать.');
      message.success('Скопировано в буфер обмена.');
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
      else message.error('Не удалось скопировать.');
    } finally {
      setMessageMenu(null);
    }
  };

  const handleEmojiPick = (emoji: EmojiEntry) => {
    setComposerText((prev) => `${prev}${emoji.char}`);
  };

  const handlePinChat = async (chatId: number, currentlyPinned: boolean) => {
    try {
      if (currentlyPinned) await api.unpinChat(chatId);
      else await api.pinChat(chatId);
      await loadChats();
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    } finally {
      setChatMenu(null);
    }
  };

  const handleDeleteChat = async (chatId: number) => {
    const target = chats.find((chat) => chat.id === chatId);
    if (target?.chat_type === 'favorites') {
      message.warning('Нельзя удалить избранное.');
      setChatMenu(null);
      return;
    }
    if (!window.confirm('Удалить чат и все сообщения?')) return;
    try {
      await api.deleteChat(chatId);
      setChats((prev) => prev.filter((chat) => chat.id !== chatId));
      if (selectedChatId === chatId) {
        setSelectedChatId(null);
        setMessages([]);
      }
      setChatMenu(null);
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    }
  };

  const handleBlockUser = async (userId: number) => {
    if (!userId) return;
    try {
      if (blockedUserIds.includes(userId)) {
        await api.unblockUser(userId);
        setBlockedUserIds((prev) => prev.filter((id) => id !== userId));
      } else {
        await api.blockUser(userId);
        setBlockedUserIds((prev) => [...prev, userId]);
      }
      setChatMenu(null);
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    }
  };

  const openProfileEditor = () => {
    setProfileDraft({
      displayName: currentUser.display_name || currentUser.username,
      about: currentUser.about || '',
      avatarFile: null,
      avatarPreview: '',
      removeAvatar: false,
    });
    setProfileModalOpen(true);
    setMenuOpen(false);
  };

  const handleProfileAvatarPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      setProfileDraft((prev) => ({
        ...prev,
        avatarPreview: result,
        avatarFile: file,
        removeAvatar: false,
      }));
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const handleRemoveAvatar = () => {
    setProfileDraft((prev) => ({
      ...prev,
      avatarPreview: '',
      avatarFile: null,
      removeAvatar: true,
    }));
  };

  const handleProfileSave = async () => {
    const trimmedName = profileDraft.displayName.trim();
    const displayName = trimmedName || currentUser.display_name || currentUser.username;
    try {
      const updatedUser = await api.updateProfile(
        displayName, profileDraft.about, profileDraft.avatarFile, profileDraft.removeAvatar,
      );
      setProfileModalOpen(false);
      message.success('Профиль сохранен.');
      onProfileUpdated(updatedUser);
      setProfileDraft((prev) => ({
        ...prev,
        avatarFile: null,
        avatarPreview: '',
        removeAvatar: false,
      }));
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    }
  };

  // --- Composer rendering ---
  const getComposerPlainText = useCallback((root: HTMLDivElement) => {
    const clone = root.cloneNode(true) as HTMLDivElement;
    clone.querySelectorAll('[data-emoji]').forEach((node) => {
      const value = (node as HTMLElement).dataset.emoji || '';
      node.replaceWith(document.createTextNode(value));
    });
    return clone.innerText;
  }, []);

  const renderComposerContent = useCallback(
    (value: string) => {
      const el = composerRef.current;
      if (!el) return;
      if (!value) {
        el.textContent = '';
        return;
      }
      const fragment = document.createDocumentFragment();
      const parts = buildEmojiParts(value);
      parts.forEach((part) => {
        if (part.type === 'text') {
          fragment.append(document.createTextNode(part.value));
          return;
        }
        const span = document.createElement('span');
        span.className = 'emoji-inline emoji-inline--image';
        span.style.backgroundImage = `url(${part.url})`;
        span.setAttribute('data-emoji', part.value);
        span.setAttribute('role', 'img');
        span.setAttribute('aria-label', part.name);
        span.contentEditable = 'false';
        fragment.append(span);
      });
      el.replaceChildren(fragment);
    },
    [buildEmojiParts],
  );

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const current = getComposerPlainText(el);
    if (current !== composerText) {
      renderComposerContent(composerText);
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [composerText, getComposerPlainText, renderComposerContent]);

  const renderMessageContent = useCallback(
    (text: string) => {
      const nodes: React.ReactNode[] = [];
      const parts = buildEmojiParts(text);
      parts.forEach((part, index) => {
        if (part.type === 'text') {
          nodes.push(part.value);
          return;
        }
        nodes.push(
          <span
            key={`${part.value}-${index}`}
            className="emoji-inline emoji-inline--image"
            style={{ backgroundImage: `url(${part.url})` }}
            role="img"
            aria-label={part.name}
          />,
        );
      });
      return nodes.length === 1 ? nodes[0] : nodes;
    },
    [buildEmojiParts],
  );

  const renderChatPreview = useCallback(
    (msg: MessageOut | null | undefined) => {
      if (!msg) return 'Сообщений пока нет';
      if (msg.message_type !== 'text') {
        if (msg.attachments.length > 0) return `${msg.attachments.length} вложений`;
        return 'Вложение';
      }
      if (!msg.content) return 'Сообщение';
      return renderMessageContent(msg.content);
    },
    [renderMessageContent],
  );

  const handleComposerPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const files = Array.from(event.clipboardData?.files || []);
      if (files.length > 0) {
        event.preventDefault();
        setAttachments((prev) => [...prev, ...files]);
        return;
      }
      const text = event.clipboardData?.getData('text');
      if (text) {
        event.preventDefault();
        const el = event.currentTarget;
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
          setComposerText((prev) => `${prev}${text}`);
          return;
        }
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        selection.collapseToEnd();
        setComposerText(el.innerText);
      }
    },
    [],
  );

  const closeCallModal = () => {
    teardownCall(true);
  };

  // --- JSX ---
  return (
    <div className={`chat-app${sidebarVisible ? '' : ' chat-app--sidebar-hidden'}`}>
      <aside className="chat-sidebar">
        <div className="sidebar-topbar">
          <Button
            type="text"
            className="sidebar-burger"
            icon={<Menu size={18} />}
            onClick={() => setMenuOpen(true)}
            aria-label="Меню"
          />
          <div className="sidebar-title">Чаты</div>
        </div>

        <div className="chat-search">
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Поиск пользователей"
            prefix={<Search size={16} color="#707579" />}
            allowClear
          />
        </div>

        <div className="chat-list">
          {searchResults.length > 0 && (
            <div className="chat-item-sub">Результаты поиска</div>
          )}
          {searchResults.map((item) => (
            <div
              key={`search-${item.id}`}
              className="search-item"
              onClick={() => handleStartChat(item.id)}
            >
              <div>
                <div className="chat-item-title">
                  {item.display_name || item.username}
                </div>
                <div className="chat-item-sub">@{item.username}</div>
              </div>
            </div>
          ))}

          {searchResults.length > 0 && <div className="chat-item-sub">Чаты</div>}

          {loadingChats ? (
            <div className="app-loading">
              <Spin />
            </div>
          ) : sortedChats.length === 0 ? (
            <div className="chat-item-sub">Пока нет чатов.</div>
          ) : (
            sortedChats.map((chat) => {
              const isDirect = isDirectChat(chat) && Boolean(chat.participant);
              const presence =
                isDirect && chat.participant
                  ? presenceMap[chat.participant.id] || chat.participant
                  : null;
              const isChatPinned = Boolean(chat.is_pinned);
              const isChatBlocked =
                isDirect && chat.participant
                  ? blockedUserIds.includes(chat.participant.id)
                  : false;
              const chatTitle = getChatTitle(chat);
              const chatSubtitle = getChatSubtitle(chat);
              return (
                <div
                  key={chat.id}
                  className={`chat-item ${chat.id === selectedChatId ? 'active' : ''} ${
                    isChatBlocked ? 'blocked' : ''
                  }`}
                  onClick={() => handleSelectChat(chat.id)}
                  onContextMenu={(event) => handleChatContext(event, chat)}
                >
                  <div className="avatar-wrapper">
                    <div
                      className="avatar-circle"
                      style={{ background: getAvatarColor(getChatAvatarSeed(chat)) }}
                    >
                      {isDirect && chat.participant?.avatar_url ? (
                        <img
                          src={resolveAvatarUrl(chat.participant.avatar_url)}
                          alt="avatar"
                        />
                      ) : (
                        getInitial(chatTitle)
                      )}
                    </div>
                    {isDirect && presence && (
                      <span
                        className={`avatar-status-dot ${
                          presence.is_online ? 'online' : 'offline'
                        }`}
                      />
                    )}
                  </div>
                  <div className="chat-item-body">
                    <div className="chat-item-row">
                      <div className="chat-item-title">{chatTitle}</div>
                      {chat.unread_count > 0 && (
                        <span className="chat-unread-badge">
                          {chat.unread_count}
                        </span>
                      )}
                    </div>
                    <div className="chat-item-sub">{renderChatPreview(chat.last_message)}</div>
                    <div className="chat-item-sub">
                      {isChatBlocked ? (
                        <span className="blocked-tag">Заблокирован</span>
                      ) : (
                        chatSubtitle
                      )}
                    </div>
                  </div>
                  {isChatPinned && <Pin size={14} className="chat-pin-icon" />}
                </div>
              );
            })
          )}
        </div>
      </aside>

      <section className="chat-main">
        {selectedChat ? (
          <>
            <div className="chat-header">
              <div>
                <div className="chat-header-title">
                  {selectedProfile?.displayName || getChatTitle(selectedChat)}
                </div>
                <div className="chat-header-status">
                  {isDirectChat(selectedChat) && selectedChat.participant ? (
                    <>
                      <span
                        className={`status-indicator ${
                          (selectedPresence?.is_online ??
                            selectedChat.participant.is_online)
                            ? 'status-online'
                            : 'status-offline'
                        }`}
                      />
                      {(selectedPresence?.is_online ??
                        selectedChat.participant.is_online)
                        ? 'онлайн'
                        : formatLastSeen(
                            selectedPresence?.last_seen_at ||
                              selectedChat.participant.last_seen_at,
                          )}
                    </>
                  ) : (
                    getChatSubtitle(selectedChat)
                  )}
                </div>
              </div>

            <div className="header-actions">
              <Button
                type="text"
                onClick={() => selectedChat && startCall('voice', selectedChat.id, selectedChat.chat_type)}
                icon={<Phone size={18} />}
                title="Голосовой звонок"
                disabled={!selectedChat || selectedChat.chat_type !== 'direct'}
              />
              <Button
                type="text"
                onClick={() => selectedChat && startCall('video', selectedChat.id, selectedChat.chat_type)}
                icon={<Video size={18} />}
                title="Видео звонок"
                disabled={!selectedChat || selectedChat.chat_type !== 'direct'}
              />
              <Button
                type="text"
                onClick={() => setSidebarVisible((prev) => !prev)}
                icon={
                  sidebarVisible ? (
                    <ChevronLeft size={18} />
                  ) : (
                    <ChevronRight size={18} />
                  )
                }
                title={sidebarVisible ? 'Скрыть список' : 'Показать список'}
              />
              {pinnedMessages.length > 0 && (
                <div className="pinned-count">
                  <Pin size={16} />
                  {pinnedMessages.length}
                  </div>
                )}
              </div>
            </div>

            {pinnedMessages.length > 0 && (
              <div className="pinned-bar pinned-bar-compact">
                <div className="pinned-bar-title">
                  <Pin size={14} />
                  Закрепленное сообщение
                </div>
                <button
                  type="button"
                  className="pinned-bar-card"
                  onClick={() => handleScrollToMessage(pinnedMessages[0].id)}
                >
                  <div className="pinned-card-text">
                    {pinnedMessages[0].content ||
                      pinnedMessages[0].message_type ||
                      'Вложение'}
                  </div>
                  <div className="pinned-card-meta">
                    <span>{formatTime(pinnedMessages[0].created_at)}</span>
                    {pinnedMessages.length > 1 && (
                      <span className="pinned-card-extra">
                        +{pinnedMessages.length - 1} еще
                      </span>
                    )}
                  </div>
                </button>
              </div>
            )}

            <div className="chat-messages" ref={chatMessagesRef}>
              {loadingMessages ? (
                <div className="app-loading">
                  <Spin />
                </div>
              ) : (
                <div
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                  }}
                >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const msg = messages[virtualRow.index];
                  const isOwn = msg.sender_id === currentUser.id;
                  const msgAttachments = msg.attachments || [];
                  const imageAttachments = msgAttachments.filter(
                    (item) => item.media_kind === 'image',
                  );
                  const otherAttachments = msgAttachments.filter(
                    (item) => item.media_kind !== 'image',
                  );
                  const mediaItems = buildMediaItems(msgAttachments);
                  const replyTarget = msg.reply_to_id
                    ? messageMap.get(msg.reply_to_id)
                    : null;
                  const replyName = replyTarget
                    ? resolveUserName(replyTarget.sender_id)
                    : 'Сообщение';
                  const replyPreview = getReplyPreview(replyTarget);
                  const forwardFromName = msg.forward_from_user_id
                    ? resolveUserName(msg.forward_from_user_id)
                    : '';
                  const isEmojiOnlyMessage =
                    msgAttachments.length === 0 &&
                    Boolean(msg.content) &&
                    isEmojiOnlyText(msg.content || '');
                  const reactions = msg.reactions || {};
                  const reactionEntries = Object.entries(reactions).sort(([a], [b]) => {
                    const aIndex = REACTION_SET.indexOf(a);
                    const bIndex = REACTION_SET.indexOf(b);
                    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
                    if (aIndex === -1) return 1;
                    if (bIndex === -1) return -1;
                    return aIndex - bIndex;
                  });
                  return (
                    <div
                      key={msg.id}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                        display: 'flex',
                        flexDirection: 'column',
                        paddingBottom: '12px',
                      }}
                    >
                    <div
                      id={`message-${msg.id}`}
                      className={`message ${isOwn ? 'self' : ''} ${
                        msg.is_pinned ? 'pinned' : ''
                      }`}
                      onContextMenu={(event) => handleMessageContext(event, msg)}
                    >
                      {editingMessageId === msg.id ? (
                        <div className="message-edit">
                          <Input.TextArea
                            value={editingText}
                            onChange={(event) =>
                              setEditingText(event.target.value)
                            }
                            autoSize={{ minRows: 1, maxRows: 4 }}
                          />
                          <div className="message-edit-actions">
                            <Button size="small" onClick={handleCancelEdit}>
                              Отмена
                            </Button>
                            <Button
                              size="small"
                              type="primary"
                              onClick={() => handleSaveEdit(msg.id)}
                            >
                              Сохранить
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {msg.forward_from_user_id && (
                            <div className="message-forwarded">
                              Переслано от {forwardFromName}
                            </div>
                          )}
                          {msg.reply_to_id && (
                            <button
                              type="button"
                              className="message-reply"
                              onClick={() =>
                                msg.reply_to_id &&
                                handleScrollToMessage(msg.reply_to_id)
                              }
                              disabled={!replyTarget}
                            >
                              <div className="message-reply-name">
                                {replyName}
                              </div>
                              <div className="message-reply-text">
                                {renderMessageContent(replyPreview)}
                              </div>
                            </button>
                          )}
                          {msg.content && (
                            <div
                              className={`message-text${
                                isEmojiOnlyMessage ? ' message-text--emoji-only' : ''
                              }`}
                            >
                              {renderMessageContent(msg.content)}
                            </div>
                          )}
                          {imageAttachments.length > 0 && (
                            <div
                              className={`image-album image-album-${Math.min(
                                imageAttachments.length,
                                4,
                              )}`}
                            >
                              {imageAttachments.map((attachment) => {
                                const url = buildApiUrl(attachment.url);
                                const index = mediaItems.findIndex(
                                  (item) => item.url === url,
                                );
                                return (
                                  <button
                                    key={attachment.id}
                                    className="image-thumb"
                                    type="button"
                                    onClick={() =>
                                      openViewer(mediaItems, Math.max(index, 0))
                                    }
                                  >
                                    <img
                                      src={url}
                                      alt={attachment.file_name}
                                    />
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {otherAttachments.length > 0 && (
                            <div className="message-attachments">
                              {otherAttachments.map((attachment) => {
                                const url = buildApiUrl(attachment.url);
                                if (attachment.media_kind === 'video') {
                                  const index = mediaItems.findIndex(
                                    (item) => item.url === url,
                                  );
                                  return (
                                    <button
                                      key={attachment.id}
                                      className="video-thumb"
                                      type="button"
                                      onClick={() =>
                                        openViewer(mediaItems, Math.max(index, 0))
                                      }
                                    >
                                      <video src={url} muted />
                                      <span className="video-label">
                                        Смотреть видео
                                      </span>
                                    </button>
                                  );
                                }
                                if (attachment.media_kind === 'audio') {
                                  return (
                                    <AudioPlayer
                                      key={attachment.id}
                                      src={url}
                                      title={attachment.file_name}
                                    />
                                  );
                                }
                                const icon = getFileIcon(attachment.file_name);
                                return (
                                  <a
                                    key={attachment.id}
                                    className="attachment-file"
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <span className={`file-icon ${icon.className}`}>
                                      {icon.label}
                                    </span>
                                    <span className="attachment-name">
                                      {attachment.file_name}
                                    </span>
                                  </a>
                                );
                              })}
                            </div>
                          )}
                          {reactionEntries.length > 0 && (
                            <div className="message-reactions">
                              {reactionEntries.map(([emoji, users]) => {
                                const active = users.includes(currentUser.id);
                                const reactionEmoji = emojiMap.get(emoji);
                                return (
                                  <button
                                    key={`${emoji}-${users.length}`}
                                    type="button"
                                    className={`reaction-chip${
                                      active ? ' active' : ''
                                    }`}
                                    onClick={() => toggleReaction(msg.id, emoji)}
                                  >
                                    <span>
                                      {reactionEmoji?.imageUrl ? (
                                        <span
                                          className="emoji-inline emoji-inline--image"
                                          style={{ backgroundImage: `url(${reactionEmoji.imageUrl})` }}
                                          role="img"
                                          aria-label={reactionEmoji.name}
                                        />
                                      ) : (
                                        emoji
                                      )}
                                    </span>
                                    <span>{users.length}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}

                      <div className="message-meta">
                        {msg.edited_at && (
                          <span className="meta-edited">изменено</span>
                        )}
                        <span>{formatTime(msg.created_at)}</span>
                        {isOwn && (
                          <span className="message-read">
                            {blockedByOther ? (
                              <span className="message-read-blocked">
                                <Eye size={14} />
                              </span>
                            ) : msg.is_read ? (
                              <CheckCheck size={14} />
                            ) : (
                              <Check size={14} />
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                    </div>
                  );
                })}
                </div>
              )}
              <div ref={scrollAnchorRef} />
            </div>

            <div className="chat-composer">
              {isBlocked && (
                <div className="blocked-banner">
                  <Ban size={16} />
                  Пользователь заблокирован. Сообщения отправлять нельзя.
                </div>
              )}

              {recording && (
                <RecordingBar
                  stream={recordingStream}
                  onCancel={cancelRecording}
                  onSend={stopRecording}
                />
              )}

              {replyTo && (
                <div className="reply-preview">
                  <div className="reply-preview-body">
                    <span className="reply-preview-label">Ответ</span>
                    <span className="reply-preview-name">
                      {resolveUserName(replyTo.sender_id)}
                    </span>
                    <span className="reply-preview-text">
                      {getReplyPreview(replyTo)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="reply-preview-close"
                    onClick={() => setReplyTo(null)}
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              {previewItems.length > 0 && (
                <div className="preview-grid">
                  {previewItems.map((item, index) => (
                    <div key={item.url} className="preview-item">
                      {item.kind === 'image' ? (
                        <img src={item.url} alt={item.file.name} />
                      ) : (
                        <div className="preview-file">{item.file.name}</div>
                      )}
                      <button
                        type="button"
                        className="preview-remove"
                        onClick={() => handleRemoveAttachment(index)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div
                className="composer-row"
                style={recording ? { display: 'none' } : undefined}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip"
                  onChange={handleFilesPicked}
                  style={{ display: 'none' }}
                  disabled={composerDisabled}
                />
                <Button
                  type="text"
                  onClick={() => fileInputRef.current?.click()}
                  icon={<Paperclip size={18} />}
                  disabled={composerDisabled}
                />
              <div className="emoji-launcher">
                <Button
                  type="text"
                  onClick={(event) => {
                    event.stopPropagation();
                    setEmojiOpen((prev) => !prev);
                  }}
                  icon={<Smile size={18} />}
                />

                {emojiOpen && (
                  <div
                  className="emoji-panel"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="emoji-search">
                    <div className="emoji-search-row">
                      <Input
                          className="emoji-search-input"
                          size="middle"
                          value={emojiSearch}
                          onChange={(event) => setEmojiSearch(event.target.value)}
                          placeholder="Поиск эмодзи"
                          allowClear
                          prefix={<Search size={14} color="#707579" />}
                      />
                      {!emojiSearchValue && (
                        <div className="emoji-categories-overlay">
                          <div
                            className="emoji-categories emoji-categories--compact"
                            ref={emojiCategoryScrollRef}
                            onMouseDown={handleCategoryMouseDown}
                            onMouseLeave={handleCategoryMouseUp}
                          >
                            {emojiCategories.map((category) => (
                              <button
                                key={category.key}
                                type="button"
                                className={`emoji-category ${
                                  emojiCategory === category.key ? 'active' : ''
                                }`}
                                onClick={() => handleEmojiCategoryClick(category.key)}
                                title={category.label}
                              >
                                {category.icon ?? category.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="emoji-scroll">
                    {emojiLoading ? (
                      <div className="emoji-empty">Загружаем эмодзи...</div>
                    ) : emojiSearchValue ? (
                      <>
                        <div className="emoji-section-title">Результаты поиска</div>
                        <div className="emoji-grid">
                          {currentEmojiList.length === 0 ? (
                            <div className="emoji-empty">Ничего не найдено.</div>
                          ) : (
                            currentEmojiList.map((emoji) => (
                              <button
                                key={emoji.key || emoji.char}
                                type="button"
                                className="emoji-item"
                                onClick={() => handleEmojiPick(emoji)}
                              >
                                {emoji.imageUrl ? (
                                  <span
                                    className="emoji-swatch"
                                    style={{ backgroundImage: `url(${emoji.imageUrl})` }}
                                    role="img"
                                    aria-label={emoji.name}
                                  />
                                ) : (
                                  emoji.char
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      </>
                    ) : (
                      emojiCategories.map((category) => {
                        if (category.key === 'recent' && category.emojis.length === 0) {
                          return null;
                        }
                        return (
                          <div
                            key={category.key}
                            className="emoji-section"
                            ref={(node) => {
                              if (node) {
                                emojiCategoryRefs.current[category.key] = node;
                              }
                            }}
                          >
                            <div className="emoji-section-title">{category.label}</div>
                            <div className="emoji-grid">
                              {category.emojis.map((emoji) => (
                                <button
                                  key={emoji.key || emoji.char}
                                  type="button"
                                  className="emoji-item"
                                  onClick={() => handleEmojiPick(emoji)}
                                >
                                  {emoji.imageUrl ? (
                                    <span
                                      className="emoji-swatch"
                                      style={{ backgroundImage: `url(${emoji.imageUrl})` }}
                                      role="img"
                                      aria-label={emoji.name}
                                    />
                                  ) : (
                                    emoji.char
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="composer-input visual-input">
              <div className="composer-visual-layer">
                {!composerText && (
                  <span className="composer-placeholder">Напишите сообщение</span>
                )}
              </div>
              <div
                ref={composerRef}
                className="composer-editable"
                contentEditable={!composerDisabled}
                suppressContentEditableWarning
                onInput={(event) => {
                  setComposerText(getComposerPlainText(event.currentTarget));
                }}
                onPaste={handleComposerPaste}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
              }}
              spellCheck={false}
            />
          </div>

          <Button
            type={composerHasContent ? 'primary' : 'text'}
            onClick={
              composerHasContent
                ? handleSend
                : recording
                  ? stopRecording
                  : startRecording
            }
            loading={composerHasContent ? sending : false}
            className="composer-send-btn"
            icon={
              <span
                className={`send-toggle${
                  composerHasContent ? ' send-toggle--send' : ' send-toggle--mic'
                }${recording ? ' send-toggle--recording' : ''}`}
              >
                <img src={sendIcon} alt="send" className="send-toggle__icon send-toggle__send" />
                <Mic size={18} className="send-toggle__icon send-toggle__mic" />
              </span>
            }
            disabled={composerDisabled}
          />
        </div>

            </div>
          </>
        ) : (
          <div className="chat-empty">Выберите чат, чтобы начать общение.</div>
        )}
      </section>

      <aside className="chat-profile">
        {selectedChat ? (
          isDirectChat(selectedChat) && selectedProfile ? (
            <>
              <div className="profile-header">
                <div
                  className="avatar-circle large"
                  style={{ background: getAvatarColor(selectedChat.participant?.id || 0) }}
                >
                {selectedProfile.avatarUrl ? (
                  <img src={selectedProfile.avatarUrl} alt="avatar" />
                ) : (
                  getInitial(
                    selectedProfile.displayName ||
                      selectedChat.participant?.username ||
                      'Чат',
                  )
                )}
                </div>
                <div className="profile-name">
                  {selectedProfile.displayName ||
                    selectedChat.participant?.username}
                </div>
                <div className="profile-username">@{selectedChat.participant?.username}</div>
                <div className="profile-status">
                  {(selectedPresence?.is_online ?? selectedChat.participant?.is_online)
                    ? 'онлайн'
                    : formatLastSeen(
                        selectedPresence?.last_seen_at ||
                          selectedChat.participant?.last_seen_at,
                      )}
                </div>
                <div className="profile-about">
                  {selectedProfile.about?.trim() || 'Описание отсутствует.'}
                </div>
              </div>

              <div className="profile-actions">
                <button
                  type="button"
                  className="profile-action"
                  onClick={() => handlePinChat(selectedChat.id, selectedChatPinned)}
                >
                  <Pin size={16} />
                  {selectedChatPinned ? 'Открепить чат' : 'Закрепить чат'}
                </button>
                <button
                  type="button"
                  className="profile-action"
                  onClick={() => handleBlockUser(selectedChat.participant?.id || 0)}
                >
                  <Ban size={16} />
                  {isBlocked ? 'Разблокировать' : 'Заблокировать'}
                </button>
                <button
                  type="button"
                  className="profile-action danger"
                  onClick={() => handleDeleteChat(selectedChat.id)}
                >
                  <Trash2 size={16} />
                  Удалить чат
                </button>
              </div>

              <div className="profile-media-tabs">
                <button
                  type="button"
                  className={sideTab === 'photos' ? 'active' : ''}
                  onClick={() => setSideTab('photos')}
                >
                  Фото ({mediaByType.photos.length})
                </button>
                <button
                  type="button"
                  className={sideTab === 'videos' ? 'active' : ''}
                  onClick={() => setSideTab('videos')}
                >
                  Видео ({mediaByType.videos.length})
                </button>
                <button
                  type="button"
                  className={sideTab === 'audio' ? 'active' : ''}
                  onClick={() => setSideTab('audio')}
                >
                  Голосовые ({mediaByType.audio.length})
                </button>
                <button
                  type="button"
                  className={sideTab === 'documents' ? 'active' : ''}
                  onClick={() => setSideTab('documents')}
                >
                  Документы ({mediaByType.documents.length})
                </button>
              </div>

              <div className="profile-media-content">
                {sideTab === 'photos' && (
                  <div className="media-grid">
                    {mediaByType.photos.length === 0 ? (
                      <div className="media-empty">Нет фотографий.</div>
                    ) : (
                      mediaByType.photos.map((attachment) => {
                        const url = buildApiUrl(attachment.url);
                        const items = buildMediaItems(
                          [...mediaByType.photos, ...mediaByType.videos],
                        );
                        const index = items.findIndex((item) => item.url === url);
                        return (
                          <button
                            key={attachment.id}
                            type="button"
                            className="media-thumb"
                            onClick={() => openViewer(items, Math.max(index, 0))}
                          >
                            <img src={url} alt={attachment.file_name} />
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
                {sideTab === 'videos' && (
                  <div className="media-list">
                    {mediaByType.videos.length === 0 ? (
                      <div className="media-empty">Нет видео.</div>
                    ) : (
                      mediaByType.videos.map((attachment) => {
                        const url = buildApiUrl(attachment.url);
                        const items = buildMediaItems(
                          [...mediaByType.photos, ...mediaByType.videos],
                        );
                        const index = items.findIndex((item) => item.url === url);
                        return (
                          <button
                            key={attachment.id}
                            type="button"
                            className="media-row"
                            onClick={() => openViewer(items, Math.max(index, 0))}
                          >
                            <ImageIcon size={16} />
                            {attachment.file_name}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
                {sideTab === 'audio' && (
                  <div className="media-list">
                    {mediaByType.audio.length === 0 ? (
                      <div className="media-empty">Нет голосовых.</div>
                    ) : (
                      mediaByType.audio.map((attachment) => (
                        <AudioPlayer
                          key={attachment.id}
                          src={buildApiUrl(attachment.url)}
                          title={attachment.file_name}
                        />
                      ))
                    )}
                  </div>
                )}
                {sideTab === 'documents' && (
                  <div className="media-list">
                    {mediaByType.documents.length === 0 ? (
                      <div className="media-empty">Нет документов.</div>
                    ) : (
                      mediaByType.documents.map((attachment) => {
                        const url = buildApiUrl(attachment.url);
                        const icon = getFileIcon(attachment.file_name);
                        return (
                          <a
                            key={attachment.id}
                            className="attachment-file"
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <span className={`file-icon ${icon.className}`}>
                              {icon.label}
                            </span>
                            <span className="attachment-name">
                              {attachment.file_name}
                            </span>
                          </a>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="profile-header">
                <div
                  className="avatar-circle large"
                  style={{ background: getAvatarColor(getChatAvatarSeed(selectedChat)) }}
                >
                  {getInitial(getChatTitle(selectedChat))}
                </div>
                <div className="profile-name">{getChatTitle(selectedChat)}</div>
                <div className="profile-status">{getChatSubtitle(selectedChat)}</div>
              </div>
              <div className="profile-actions">
                <button
                  type="button"
                  className="profile-action"
                  onClick={() => handlePinChat(selectedChat.id, selectedChatPinned)}
                >
                  <Pin size={16} />
                  {selectedChatPinned ? 'Открепить чат' : 'Закрепить чат'}
                </button>
                {selectedChat.chat_type !== 'favorites' && (
                  <button
                    type="button"
                    className="profile-action danger"
                    onClick={() => handleDeleteChat(selectedChat.id)}
                  >
                    <Trash2 size={16} />
                    Удалить чат
                  </button>
                )}
              </div>
            </>
          )
        ) : (
          <div className="profile-empty">
            Выберите чат, чтобы посмотреть профиль.
          </div>
        )}
      </aside>

      {messageMenu && (
        <div
          className="context-menu"
          style={{ top: messageMenu.y, left: messageMenu.x }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="context-menu-reactions">
            {REACTION_SET.map((emoji) => {
              const users = messageMenuReactions[emoji] || [];
              const reactionEmoji = emojiMap.get(emoji);
              const active = users.includes(currentUser.id);
              return (
                <button
                  key={emoji}
                  type="button"
                  className={`reaction-button${active ? ' active' : ''}`}
                  onClick={() => toggleReaction(messageMenu.message.id, emoji)}
                >
                  {reactionEmoji?.imageUrl ? (
                    <span
                      className="emoji-inline emoji-inline--image"
                      style={{ backgroundImage: `url(${reactionEmoji.imageUrl})` }}
                      role="img"
                      aria-label={reactionEmoji.name}
                    />
                  ) : (
                    emoji
                  )}
                </button>
              );
            })}
          </div>
          <div className="context-menu-divider" />
          <button type="button" onClick={() => handleReplyMessage(messageMenu.message)}>
            Ответить
          </button>
          <button type="button" onClick={() => handleForwardMessage(messageMenu.message)}>
            Переслать
          </button>
          <button type="button" onClick={() => handleCopyMessage(messageMenu.message)}>
            Копировать
          </button>
          <button type="button" onClick={() => handleTogglePin(messageMenu.message)}>
            {messageMenu.message.is_pinned ? 'Открепить' : 'Закрепить'}
          </button>
          {messageMenu.message.sender_id === currentUser.id &&
            messageMenu.message.message_type === 'text' && (
              <button type="button" onClick={() => handleEditMessage(messageMenu.message)}>
                Редактировать
              </button>
            )}
          {messageMenu.message.sender_id === currentUser.id && (
            <button
              type="button"
              className="danger"
              onClick={() => handleDeleteMessage(messageMenu.message.id)}
            >
              Удалить
            </button>
          )}
        </div>
      )}

      {chatMenu && (
        <div
          className="context-menu"
          style={{ top: chatMenu.y, left: chatMenu.x }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() =>
              handlePinChat(chatMenu.chat.id, Boolean(chatMenu.chat.is_pinned))
            }
          >
            {chatMenu.chat.is_pinned ? 'Открепить чат' : 'Закрепить чат'}
          </button>
          {isDirectChat(chatMenu.chat) && chatMenu.chat.participant && (
            <button
              type="button"
              onClick={() => handleBlockUser(chatMenu.chat.participant!.id)}
            >
              {blockedUserIds.includes(chatMenu.chat.participant!.id)
                ? 'Разблокировать'
                : 'Заблокировать'}
            </button>
          )}
          {chatMenu.chat.chat_type !== 'favorites' && (
            <button
              type="button"
              className="danger"
              onClick={() => handleDeleteChat(chatMenu.chat.id)}
            >
              Удалить чат
            </button>
          )}
        </div>
      )}

      <Modal
        title="Переслать сообщение"
        open={forwardModalOpen}
        onCancel={() => {
          setForwardModalOpen(false);
          setForwardMessage(null);
          setForwardChatId(null);
        }}
        onOk={handleForwardSend}
        okText="Переслать"
        cancelText="Отмена"
        okButtonProps={{ disabled: !forwardChatId, loading: forwardSending }}
      >
        <div className="forward-list">
          {sortedChats.length === 0 ? (
            <div className="forward-empty">Нет доступных чатов.</div>
          ) : (
            sortedChats.map((chat) => {
              const name = getChatTitle(chat);
              const isDirect = isDirectChat(chat) && Boolean(chat.participant);
              const disabled = chat.id === selectedChatId;
              return (
                <button
                  key={chat.id}
                  type="button"
                  className={`forward-item${
                    forwardChatId === chat.id ? ' active' : ''
                  }`}
                  onClick={() => setForwardChatId(chat.id)}
                  disabled={disabled}
                >
                  <div
                    className="avatar-circle"
                    style={{ background: getAvatarColor(getChatAvatarSeed(chat)) }}
                  >
                    {isDirect && chat.participant?.avatar_url ? (
                      <img
                        src={resolveAvatarUrl(chat.participant.avatar_url)}
                        alt="avatar"
                      />
                    ) : (
                      getInitial(name)
                    )}
                  </div>
                  <span className="forward-name">{name}</span>
                  {disabled && <span className="forward-tag">Этот чат</span>}
                </button>
              );
            })
          )}
        </div>
      </Modal>

      <Drawer
        title="Меню"
        placement="left"
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        className="sidebar-drawer"
      >
        <div className="drawer-user" role="button" onClick={openProfileEditor}>
          <div
            className="avatar-circle"
            style={{ background: getAvatarColor(currentUser.id) }}
          >
            {currentUser.avatar_url ? (
              <img src={resolveAvatarUrl(currentUser.avatar_url)} alt="avatar" />
            ) : (
              getInitial(currentUser.display_name || currentUser.username)
            )}
          </div>
          <div className="drawer-user-info">
            <div className="drawer-user-name">
              {currentUser.display_name || currentUser.username}
            </div>
            <div className="drawer-user-sub">@{currentUser.username}</div>
          </div>
        </div>
        <div className="drawer-actions">
          <Button onClick={() => openCreateModal('group')}>Новая группа</Button>
          <Button onClick={() => openCreateModal('channel')}>Новый канал</Button>
        </div>
      </Drawer>

      <Modal
        title={createChatType === 'group' ? 'Новая группа' : 'Новый канал'}
        open={createModalOpen}
        onCancel={() => {
          setCreateModalOpen(false);
          setCreateTitle('');
          setCreateQuery('');
          setCreateResults([]);
          setCreateMembers([]);
        }}
        onOk={handleCreateSubmit}
        okText="Создать"
        cancelText="Отмена"
        okButtonProps={{ disabled: createTitle.trim().length === 0, loading: createLoading }}
      >
        <div className="create-chat-modal">
          <label>
            Название
            <Input
              value={createTitle}
              onChange={(event) => setCreateTitle(event.target.value)}
              placeholder="Введите название"
            />
          </label>
          <div className="create-chat-hint">
            Создатель будет добавлен автоматически.
          </div>
          <label>
            Добавить участников
            <Input
              value={createQuery}
              onChange={(event) => setCreateQuery(event.target.value)}
              placeholder="Поиск пользователей"
              allowClear
            />
          </label>
          {createMembers.length > 0 && (
            <div className="create-chat-members">
              {createMembers.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  className="create-chat-member"
                  onClick={() => handleCreateRemoveMember(member.id)}
                >
                  <span className="create-chat-member-name">
                    {member.display_name || member.username}
                  </span>
                  <X size={14} />
                </button>
              ))}
            </div>
          )}
          {createResults.length > 0 && (
            <div className="create-chat-results">
              {createResults.map((item) => (
                <button
                  key={`create-${item.id}`}
                  type="button"
                  className="create-chat-result"
                  onClick={() => handleCreateAddMember(item)}
                >
                  <span>{item.display_name || item.username}</span>
                  <span className="create-chat-result-username">@{item.username}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        title={null}
        open={callModalOpen}
        onCancel={closeCallModal}
        footer={null}
        closable={false}
        className="call-modal"
        width={420}
      >
        <div className={`call-screen ${callType}`}>
          <div className="call-header">
            <div className="call-title">
              {callType === 'video' ? 'Видео звонок' : 'Голосовой звонок'}
            </div>
            <button type="button" className="call-close" onClick={closeCallModal}>
              <X size={16} />
            </button>
          </div>
          <div className="call-body">
            {callType === 'video' ? (
              <div className="call-video-stage">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="call-video-remote"
                />
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`call-video-local ${callCameraOff ? 'off' : ''}`}
                />
              </div>
            ) : (
              <div className="call-avatar">
                {selectedChat ? getInitial(getChatTitle(selectedChat)) : '?'}
                <span className="call-pulse" />
                <span className="call-pulse delay" />
              </div>
            )}
            <div className="call-name">
              {selectedChat ? getChatTitle(selectedChat) : 'Чат'}
            </div>
            <div className="call-status">
              {callActive ? formatCallTime(callElapsed) : 'Подключение...'}
            </div>
            <audio ref={remoteAudioRef} autoPlay />
          </div>
          <div className="call-controls">
            <button
              type="button"
              className={`call-control ${callMuted ? 'active' : ''}`}
              onClick={handleToggleMute}
            >
              <Mic size={18} />
              {callMuted ? 'Микрофон выкл.' : 'Микрофон'}
            </button>
            {callType === 'video' && (
              <button
                type="button"
                className={`call-control ${callCameraOff ? 'active' : ''}`}
                onClick={handleToggleCamera}
              >
                <Video size={18} />
                {callCameraOff ? 'Камера выкл.' : 'Камера'}
              </button>
            )}
            <button type="button" className="call-control danger" onClick={closeCallModal}>
              <PhoneOff size={18} />
              Завершить
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        title="Входящий звонок"
        open={Boolean(incomingCall)}
        onCancel={declineCall}
        footer={null}
        className="incoming-call-modal"
      >
        <div className="incoming-call-body">
          <div className="incoming-call-avatar">
            {incomingChat ? getInitial(getChatTitle(incomingChat)) : '?'}
          </div>
          <div className="incoming-call-info">
            <div className="incoming-call-name">
              {incomingChat ? getChatTitle(incomingChat) : 'Неизвестный'}
            </div>
            <div className="incoming-call-sub">
              {incomingCall?.callType === 'video' ? 'Видео звонок' : 'Голосовой звонок'}
            </div>
          </div>
          <div className="incoming-call-actions">
            <Button onClick={declineCall}>Отклонить</Button>
            <Button type="primary" onClick={acceptCall}>
              Принять
            </Button>
          </div>
        </div>
      </Modal>

      {viewer && (
        <div className="media-viewer" onClick={closeViewer}>
          <button
            type="button"
            className="media-close"
            onClick={closeViewer}
          >
            <X size={18} />
          </button>
          {viewer.items.length > 1 && (
            <button
              type="button"
              className="media-nav prev"
              onClick={(event) => {
                event.stopPropagation();
                handleViewerPrev();
              }}
            >
              <ChevronLeft size={20} />
            </button>
          )}
          <div
            className="media-frame"
            onClick={(event) => event.stopPropagation()}
            onWheel={handleViewerWheel}
          >
            {viewer.items[viewer.index].type === 'image' ? (
              <img
                src={viewer.items[viewer.index].url}
                alt={viewer.items[viewer.index].title}
                style={{ transform: `scale(${viewerZoom})` }}
              />
            ) : (
              <video
                src={viewer.items[viewer.index].url}
                controls
                autoPlay
              />
            )}
            <div className="media-caption">
              {viewer.items[viewer.index].title}
            </div>
            {viewer.items[viewer.index].type === 'image' && (
              <div className="media-zoom-controls">
                <button
                  type="button"
                  onClick={() => setViewerZoom((prev) => Math.max(0.5, prev - 0.2))}
                >
                  −
                </button>
                <span>{Math.round(viewerZoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setViewerZoom((prev) => Math.min(3, prev + 0.2))}
                >
                  +
                </button>
              </div>
            )}
          </div>
          {viewer.items.length > 1 && (
            <button
              type="button"
              className="media-nav next"
              onClick={(event) => {
                event.stopPropagation();
                handleViewerNext();
              }}
            >
              <ChevronRight size={20} />
            </button>
          )}
        </div>
      )}

      <Modal
        title="Мой профиль"
        open={profileModalOpen}
        onCancel={() => setProfileModalOpen(false)}
        onOk={handleProfileSave}
        okText="Сохранить"
        cancelText="Отмена"
        footer={null}
      >
        <div className="profile-modal">
          <div className="profile-modal-avatar">
            <div className="avatar-circle large" style={{ background: getAvatarColor(currentUser.id) }}>
              {activeProfileAvatar ? (
                <img src={activeProfileAvatar} alt="avatar" />
              ) : (
                getInitial(profileDraft.displayName || currentUser.username)
              )}
            </div>
            <div className="profile-modal-actions">
              <input
                ref={profileAvatarInputRef}
                type="file"
                accept="image/*"
                onChange={handleProfileAvatarPick}
                style={{ display: 'none' }}
              />
              <Button onClick={() => profileAvatarInputRef.current?.click()}>
                Изменить фото
              </Button>
              {showRemoveAvatarButton && (
                <Button type="text" onClick={handleRemoveAvatar}>
                  Удалить фото
                </Button>
              )}
            </div>
          </div>
          <div className="profile-modal-fields">
            <label>
              Имя
              <Input
                value={profileDraft.displayName}
                onChange={(event) =>
                  setProfileDraft((prev) => ({ ...prev, displayName: event.target.value }))
                }
                placeholder="Как вас будут видеть другие"
              />
            </label>
            <label>
              Описание
              <Input.TextArea
                value={profileDraft.about}
                onChange={(event) =>
                  setProfileDraft((prev) => ({ ...prev, about: event.target.value }))
                }
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder="Расскажите о себе"
              />
            </label>
          </div>
          <div className="profile-modal-actions-row">
            <Button danger onClick={handleLogout} icon={<LogOut size={16} />}>
              Выйти из аккаунта
            </Button>
            <div className="profile-modal-actions-save">
              <Button onClick={() => setProfileModalOpen(false)}>Отмена</Button>
              <Button type="primary" onClick={handleProfileSave} loading={sending}>
                Сохранить
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};
