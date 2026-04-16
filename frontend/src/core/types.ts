export interface UserPublic {
  id: number;
  username: string;
  display_name: string;
  last_seen_at?: string | null;
  avatar_url?: string | null;
  about?: string | null;
  is_online?: boolean | null;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: UserPublic;
}

export interface ChatParticipantOut {
  id: number;
  username: string;
  display_name: string;
  last_seen_at?: string | null;
  avatar_url?: string | null;
  about?: string | null;
  is_online?: boolean | null;
}

export interface AttachmentOut {
  id: number;
  url: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  media_kind: string;
}

export interface MessageOut {
  id: number;
  chat_id: number;
  sender_id: number | null;
  message_type: string;
  content: string | null;
  reply_to_id?: number | null;
  forward_from_user_id?: number | null;
  created_at: string;
  edited_at?: string | null;
  read_at?: string | null;
  is_read?: boolean;
  is_pinned?: boolean;
  attachments: AttachmentOut[];
  reactions?: Record<string, number[]>;
}

export interface ChatSummary {
  id: number;
  chat_type: 'direct' | 'group' | 'channel' | 'favorites';
  title?: string | null;
  participant?: ChatParticipantOut | null;
  participants_count?: number;
  owner_id?: number | null;
  blocked_by_me?: boolean;
  blocked_by_other?: boolean;
  last_message: MessageOut | null;
  unread_count: number;
  is_pinned?: boolean;
}

export interface SearchResult {
  id: number;
  username: string;
  display_name: string;
  score: number;
}

export interface WebhookOut {
  id: number;
  url: string;
  events: string[];
  enabled: boolean;
  created_at: string;
}

export interface WebhookCreate {
  url: string;
  secret?: string;
  events: string[];
}

export interface WebhookEvent {
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
}
