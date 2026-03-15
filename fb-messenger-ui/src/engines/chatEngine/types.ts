/**
 * Message Engine Types — Pancake-style chat architecture
 */

import type { MessageData, MessageMedia } from '../../types/message';

/** Message với rowId nội bộ — giữ key ổn định khi tempId → realId (tránh nháy UI) */
export interface MessageWithRow extends MessageData {
  /** Stable key cho For — không đổi khi ack tempId→realId */
  rowId?: string;
}

/** Cấu trúc chuẩn hóa cho một conversation — O(1) truy cập message */
export interface ConversationMessages {
  messages: Record<string, MessageWithRow>;
  order: string[];
  beforeCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
}

/** Store chuẩn hóa: [conversationId] → ConversationMessages */
export interface ChatEngineStore {
  convs: Record<string, ConversationMessages>;
}

/** Payload gửi tin — có thể mở rộng cho media */
export interface SendPayload {
  text?: string;
  media?: MessageMedia;
  medias?: MessageMedia[];
}

/** Kết quả gửi — Server trả về clientMsgId + serverId để ack */
export interface SendResult {
  clientMsgId: string;
  serverId?: string;
  ok: boolean;
}

/** API fetch latest — chỉ lấy tin mới để merge */
export interface FetchLatestOptions {
  conversationId: string;
  pageId: string;
  /** Nếu có: chỉ lấy tin sau messageId này */
  afterMessageId?: string;
}

/** Adapter Socket — tách biệt logic kết nối */
export interface SocketAdapter {
  onNewMessage: (handler: (data: IncomingMessagePayload) => void) => () => void;
  onMessageEcho: (handler: (data: IncomingMessagePayload) => void) => () => void;
  onMessagesUpdated?: (handler: (data: { convId: string }) => void) => () => void;
}

export interface IncomingMessagePayload {
  pageId: string;
  convId: string | null;
  senderId?: string;
  recipientId?: string;
  text: string | null;
  timestamp: number;
  messageId?: string;
}
