/**
 * Socket Adapter — tách biệt logic kết nối Socket khỏi Chat Engine
 *
 * Implement cho Socket.io (syncService) hoặc SSE (fbRealtimeService).
 * Chat Engine chỉ nhận events qua interface SocketAdapter.
 */
import type { Socket } from 'socket.io-client';
import type { SocketAdapter as ISocketAdapter, IncomingMessagePayload } from './types';

export function createSocketIoAdapter(socket: Socket | null): ISocketAdapter {
  if (!socket) {
    return {
      onNewMessage: () => () => {},
      onMessageEcho: () => () => {},
      onMessagesUpdated: () => () => {},
    };
  }

  return {
    onNewMessage(handler) {
      const fn = (data: {
        pageId: string;
        senderId: string;
        convId: string | null;
        text: string | null;
        timestamp: number;
      }) => {
        handler({
          pageId: data.pageId,
          convId: data.convId,
          senderId: data.senderId,
          text: data.text,
          timestamp: data.timestamp,
        } as IncomingMessagePayload);
      };
      socket.on('new_message', fn);
      return () => socket.off('new_message', fn);
    },

    onMessageEcho(handler) {
      const fn = (data: {
        pageId: string;
        recipientId: string;
        convId: string | null;
        text: string | null;
        timestamp: number;
      }) => {
        handler({
          pageId: data.pageId,
          convId: data.convId,
          recipientId: data.recipientId,
          text: data.text,
          timestamp: data.timestamp,
        } as IncomingMessagePayload);
      };
      socket.on('message_echo', fn);
      return () => socket.off('message_echo', fn);
    },

    onMessagesUpdated(handler) {
      const fn = (data: { convId: string }) => handler(data);
      socket.on('messages_updated', fn);
      return () => socket.off('messages_updated', fn);
    },
  };
}
