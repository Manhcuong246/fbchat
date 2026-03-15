/**
 * VirtualMessageList — Hướng dẫn tích hợp Virtual Scroll
 *
 * Sử dụng <For /> của SolidJS để đảm bảo khi thêm tin mới,
 * các node cũ hoàn toàn không bị động chạm (chỉ node mới render).
 *
 * Để Virtual Scroll: dùng solid-virtual hoặc logic tự viết:
 * 1. Đo viewport height + scroll position
 * 2. Tính range [startIndex, endIndex] cần render
 * 3. Chỉ map messages trong range, dùng padding top/bottom để giữ scrollHeight
 */
import { For, createMemo } from 'solid-js';
import type { MessageWithRow } from './types';

export interface VirtualMessageListProps {
  messages: () => MessageWithRow[];
  renderMessage: (msg: MessageWithRow, index: number) => unknown;
  /** Optional: render date separator */
  renderDateSeparator?: (label: string) => unknown;
  /** Optional: get date label for message at index */
  getDateLabel?: (messages: MessageWithRow[], index: number) => string | null;
}

/**
 * MessageList dùng For — key bằng rowId để tránh nháy khi tempId→realId
 */
export function MessageList(props: VirtualMessageListProps) {
  const messages = createMemo(() => props.messages());

  return (
    <For each={messages()}>
      {(msg, i) => {
        const idx = i();
        const list = messages();
        const dateLabel = props.getDateLabel?.(list, idx) ?? null;
        return (
          <>
            {dateLabel != null && props.renderDateSeparator?.(dateLabel)}
            {props.renderMessage(msg, idx)}
          </>
        );
      }}
    </For>
  );
}
