export interface MessageMedia {
  type: 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'share' | 'fallback' | 'pending';
  url: string | null;
  attachmentId?: string;
  thumbnailUrl?: string;
  filename?: string;
  title?: string;
}
export type MessageSendStatus = 'sending' | 'sent' | 'failed';

export interface MessageData {
  id: string;
  conversationId: string;
  text?: string;
  media?: MessageMedia;
  medias?: MessageMedia[];
  /** Chỉ set khi chưa fetch attachment (lazy load). */
  attachmentIds?: string[];
  /** True khi message có attachment cần lazy fetch qua /{messageId}/attachments. */
  hasAttachment?: boolean;
  timestamp: number;
  isFromPage: boolean;
  /** Sender ID (from.id) for grouping consecutive messages. */
  fromId?: string;
  senderName: string;
  isRead: boolean;
  sendStatus?: MessageSendStatus;
}
