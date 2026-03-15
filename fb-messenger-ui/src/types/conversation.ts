export interface ParticipantData {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface ConversationData {
  id: string;
  pageId: string;
  pageName: string;
  pageAvatarUrl?: string;
  pageColor?: string;
  participant: ParticipantData;
  lastMessage: string;
  lastMessageTime: number;
  unreadCount: number;
  isRead: boolean;
  latestMessageId: string;
}
