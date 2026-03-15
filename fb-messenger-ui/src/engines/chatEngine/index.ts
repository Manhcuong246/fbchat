/**
 * Chat Engine — Message Engine kiểu Pancake
 *
 * @example
 * ```ts
 * const engine = createChatEngine({
 *   fetchLatest: async ({ conversationId, pageId }) => {
 *     const res = await fetch(`/api/messages/${conversationId}?pageId=${pageId}`);
 *     const data = await res.json();
 *     return data.messages ?? [];
 *   },
 *   sendMessage: async ({ conversationId, pageId, recipientId, payload, clientMsgId }) => {
 *     const ok = await sendToServer(...);
 *     return { clientMsgId, serverId: response?.id, ok };
 *   },
 *   resolveConvId: async (pageId, participantId) => { ... },
 *   getPageIdForConv: (convId) => convState.conversations.find(c => c.id === convId)?.pageId ?? null,
 * });
 *
 * // Load cache khi mở hội thoại
 * engine.loadCache(convId) || engine.updateCache(convId, pageId);
 *
 * // Gửi tin
 * await engine.send(convId, pageId, recipientId, { text: 'Hello' }, { pageName: 'Page' });
 *
 * // Kết nối Socket
 * const disconnect = engine.connectSocket(createSocketIoAdapter(socket));
 * ```
 */

export { createChatEngine } from './createChatEngine';
export { createSocketIoAdapter } from './socketAdapter';
export { MessageList } from './VirtualMessageList';
export type {
  ChatEngineStore,
  ConversationMessages,
  MessageWithRow,
  SendPayload,
  SendResult,
  FetchLatestOptions,
  SocketAdapter,
  IncomingMessagePayload,
} from './types';
export type { CreateChatEngineOptions } from './createChatEngine';
