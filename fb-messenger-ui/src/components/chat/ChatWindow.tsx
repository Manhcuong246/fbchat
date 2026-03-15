import { createEffect, on, For, Show, createSignal, batch, createMemo } from 'solid-js';
import { MessageBubble, type BubblePosition } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { msgState, setMsgState } from '../../stores/messageStore';
import { convState, setConvState } from '../../stores/conversationStore';
import { authState } from '../../stores/authStore';
import { fetchMessages, notifySent } from '../../services/syncService';
import { getMessages, sendMessage, sendImageMessage } from '../../services/fbMessageService';
import type { QuickReply, QuickReplyBlock } from '../../services/quickReplyService';
import type { MessageData } from '../../types/message';
import type { LibraryImage } from '../../types/library';
import { formatLastSeen } from '../../utils/timeUtils';
import { Avatar } from '../shared/Avatar';
import type { PageInfo } from '../../types/auth';

function getBubblePosition(messages: MessageData[], index: number): BubblePosition {
  const cur = messages[index];
  const prev = messages[index - 1];
  const next = messages[index + 1];

  const TIME_THRESHOLD = 2 * 60 * 1000; // 2 phút

  const sameAsPrev =
    prev &&
    prev.isFromPage === cur.isFromPage &&
    prev.fromId === cur.fromId &&
    cur.timestamp - prev.timestamp < TIME_THRESHOLD;

  const sameAsNext =
    next &&
    next.isFromPage === cur.isFromPage &&
    cur.fromId === next.fromId &&
    next.timestamp - cur.timestamp < TIME_THRESHOLD;

  if (!sameAsPrev && !sameAsNext) return 'single';
  if (!sameAsPrev && sameAsNext) return 'first';
  if (sameAsPrev && sameAsNext) return 'middle';
  if (sameAsPrev && !sameAsNext) return 'last';
  return 'single';
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Hôm nay';
  if (date.toDateString() === yesterday.toDateString()) return 'Hôm qua';

  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function shouldShowDate(messages: MessageData[], index: number): string | null {
  const cur = messages[index];
  const prev = messages[index - 1];

  if (!prev) return formatDate(cur.timestamp);

  const curDate = new Date(cur.timestamp).toDateString();
  const prevDate = new Date(prev.timestamp).toDateString();

  if (curDate !== prevDate) return formatDate(cur.timestamp);
  return null;
}

const DateSeparator = (props: { label: string }) => (
  <div class="date-separator">
    <span class="date-label">{props.label}</span>
  </div>
);

export const ChatWindow = () => {
  let scrollContainer: HTMLDivElement | undefined;

  const selectedConv = () =>
    convState.conversations.find((c) => c.id === convState.selectedId);

  // Lấy page tương ứng với conversation đang mở
  const getPage = (): PageInfo | null => {
    const conv = selectedConv();
    if (!conv) return null;
    return authState.selectedPages.find((p) => p.id === conv.pageId) ?? null;
  };

  const messages = () => {
    const id = convState.selectedId;
    if (!id) return [];
    return msgState.messages[id] ?? [];
  };

  /** Lọc bỏ tin nhắn rỗng (giao dịch thanh toán, hasAttachment không parse được, v.v.) */
  const displayMessages = createMemo(() => {
    const list = messages();
    return list.filter((msg) => {
      const hasText = msg.text != null && String(msg.text).trim() !== '';
      const hasMedias = (msg.medias && msg.medias.length > 0) || msg.media;
      // hasAttachment alone (không có medias) = payment/transaction không render được — ẩn
      return hasText || hasMedias;
    });
  });

  createEffect(
    on(
      () => convState.selectedId,
      (convId) => {
        if (!convId) return;
        const conv = convState.conversations.find((c) => c.id === convId);
        if (!conv) return;
        setMsgState('loading', true);
        fetchMessages(convId, conv.pageId).finally(() => setMsgState('loading', false));
      },
      { defer: true }
    )
  );

  // Cuộn xuống dưới sau khi DOM đã render tin mới — double rAF đảm bảo layout xong
  createEffect(() => {
    const id = convState.selectedId;
    const msgs = messages();
    if (!id || !msgs.length || msgState.loading) return;
    const c = scrollContainer;
    if (!c) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (c) c.scrollTop = c.scrollHeight;
      });
    });
  });

  const loadMoreMessages = () => {
    const id = convState.selectedId;
    const conv = selectedConv();
    const page = conv ? authState.selectedPages.find((p) => p.id === conv.pageId) ?? null : null;
    if (!id || !page?.accessToken || !page?.id || msgState.loadingMore) return;
    const before = msgState.beforeCursors[id];
    if (!before) return;
    setMsgState('loadingMore', true);
    const container = scrollContainer;
    const oldScrollHeight = container?.scrollHeight ?? 0;
    const oldScrollTop = container?.scrollTop ?? 0;
    getMessages(id, page.accessToken, page.id, before)
      .then(({ messages: older, beforeCursor: nextBefore }) => {
        const current = msgState.messages[id] ?? [];
        const merged = [...older, ...current];
        setMsgState('messages', id, merged);
        setMsgState('beforeCursors', id, nextBefore);
        if (merged.length) {
          const last = merged[merged.length - 1];
          setConvState('conversations', (list) =>
            list.map((c) =>
              c.id === id
                ? { ...c, lastMessage: last.text ?? 'Tệp đính kèm', lastMessageTime: last.timestamp }
                : c
            ).sort((a, b) => b.lastMessageTime - a.lastMessageTime)
          );
        }
        requestAnimationFrame(() => {
          if (container) {
            const newScrollHeight = container.scrollHeight;
            container.scrollTop = newScrollHeight - oldScrollHeight + oldScrollTop;
          }
          setMsgState('loadingMore', false);
        });
      })
      .catch(() => {
        setMsgState('loadingMore', false);
      });
  };

  const updateMessageStatus = (conversationId: string, messageId: string, updates: Partial<MessageData>) => {
    setMsgState('messages', conversationId, (list) =>
      (list ?? []).map((m) => (m.id === messageId ? { ...m, ...updates } : m))
    );
  };

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
      });
    });
  };

  const sendImageFromLibrary = async (imageUrl: string, token: string, recipientId: string) => {
    console.log('[SEND IMAGE] imageUrl:', imageUrl.substring(0, 80));
    console.log('[SEND IMAGE] recipientId:', recipientId);
    console.log('[SEND IMAGE] token (first 20):', token.substring(0, 20));

    const res = await fetch('http://localhost:3001/api/messages/send-image-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, recipientId, imageUrl }),
    });

    const data = await res.json();
    console.log('[SEND IMAGE] response:', res.status, JSON.stringify(data));
    return res.ok;
  };

  const handleSend = async (
    text: string,
    imageBase64?: string,
    imageType?: string,
    libraryImages?: LibraryImage[]
  ) => {
    const id = convState.selectedId;
    const page = getPage();
    const conv = selectedConv();
    if (!id || !page?.accessToken || !conv) return;
    const recipientId = conv.participant.id;
    const token = page.accessToken;

    // Optimistic: text
    if (text.trim()) {
      const tempId = `temp-${Date.now()}-text`;
      const optimistic: MessageData = {
        id: tempId, conversationId: id, text: text.trim(), timestamp: Date.now(),
        isFromPage: true, fromId: page.id, senderName: page.name,
        isRead: false, sendStatus: 'sending',
      };
      setMsgState('messages', id, (prev) => [...(prev ?? []), optimistic]);
      scrollToBottom();
      const ok = await sendMessage(token, recipientId, text.trim(), page.id);
      updateMessageStatus(id, tempId, { sendStatus: ok ? 'sent' : 'failed', isRead: ok });
      if (ok) notifySent(id, page.id);
    }

    // Optimistic + send: library images (URL)
    if (libraryImages && libraryImages.length > 0) {
      for (let idx = 0; idx < libraryImages.length; idx++) {
        const img = libraryImages[idx];
        const tempId = `temp-lib-${Date.now()}-${idx}`;
        const optimisticImg: MessageData = {
          id: tempId, conversationId: id, timestamp: Date.now() + idx,
          isFromPage: true, fromId: page.id, senderName: page.name,
          isRead: false, sendStatus: 'sending',
          media: { type: 'image', url: img.url },
        };
        setMsgState('messages', id, (prev) => [...(prev ?? []), optimisticImg]);
        scrollToBottom();

        const ok = await sendImageFromLibrary(img.url, token, recipientId);
        updateMessageStatus(id, tempId, { sendStatus: ok ? 'sent' : 'failed', isRead: ok });
        if (ok) notifySent(id, page.id);
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // Optimistic + send: file image (base64)
    if (imageBase64 && imageType) {
      const imgTempId = `temp-img-${Date.now()}`;
      const optimisticImg: MessageData = {
        id: imgTempId, conversationId: id, timestamp: Date.now(),
        isFromPage: true, fromId: page.id, senderName: page.name,
        isRead: false, sendStatus: 'sending', media: { type: 'image', url: '' },
      };
      setMsgState('messages', id, (prev) => [...(prev ?? []), optimisticImg]);
      scrollToBottom();
      const ok = await sendImageMessage(token, recipientId, imageBase64, imageType);
      updateMessageStatus(id, imgTempId, { sendStatus: ok ? 'sent' : 'failed', isRead: ok });
      if (ok) notifySent(id, page.id);
      await new Promise((r) => setTimeout(r, 100));
    }

    // Update conversation preview: cập nhật 1 conv và đưa lên đầu (sort theo lastMessageTime)
    const preview = text.trim() || (libraryImages?.length ? `${libraryImages.length} ảnh` : '') || (imageBase64 ? 'Ảnh' : '');
    if (id && conv && (text.trim() || libraryImages?.length || imageBase64)) {
      batch(() => {
        const list = convState.conversations;
        const idx = list.findIndex((c) => c.id === id);
        const updated = { ...conv, lastMessage: preview, lastMessageTime: Date.now() };
        const next = idx >= 0
          ? [updated, ...list.slice(0, idx), ...list.slice(idx + 1)]
          : [updated, ...list];
        setConvState('conversations', next.sort((a, b) => b.lastMessageTime - a.lastMessageTime));
      });
    }
  };

  const addOptimisticText = (conversationId: string, text: string, pageId: string, pageName: string): string => {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: MessageData = {
      id: tempId,
      conversationId,
      text,
      timestamp: Date.now(),
      isFromPage: true,
      fromId: pageId,
      senderName: pageName,
      isRead: false,
      sendStatus: 'sending',
    };
    setMsgState('messages', conversationId, (prev) => [...(prev ?? []), optimistic]);
    scrollToBottom();
    return tempId;
  };

  const addOptimisticImage = (conversationId: string, pageId: string, pageName: string): string => {
    const tempId = `temp-img-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimisticImg: MessageData = {
      id: tempId, conversationId, timestamp: Date.now(),
      isFromPage: true, fromId: pageId, senderName: pageName,
      isRead: false, sendStatus: 'sending', media: { type: 'image', url: '' },
    };
    setMsgState('messages', conversationId, (prev) => [...(prev ?? []), optimisticImg]);
    scrollToBottom();
    return tempId;
  };

  const sendQuickReply = async (reply: QuickReply) => {
    const id = convState.selectedId;
    const page = getPage();
    const conv = selectedConv();
    if (!id || !page?.accessToken || !conv) return;
    const recipientId = conv.participant.id;
    const token = page.accessToken;

    const sendBlock = async (block: QuickReplyBlock) => {
      if (block.type === 'text' && block.text && block.text.trim()) {
        const text = block.text.trim();
        const tempId = addOptimisticText(id, text, page.id, page.name);
        const ok = await sendMessage(token, recipientId, text);
        if (ok) {
          updateMessageStatus(id, tempId, { sendStatus: 'sent', isRead: true });
          notifySent(id, page.id);
        } else {
          updateMessageStatus(id, tempId, { sendStatus: 'failed' });
        }
      } else if (block.type === 'image' && block.imageFile) {
        const dataUrl = block.imageFile;
        const mime = dataUrl.match(/^data:([^;]+);/)?.[1] ?? 'image/jpeg';
        const tempId = addOptimisticImage(id, page.id, page.name);
        const ok = await sendImageMessage(token, recipientId, dataUrl, mime);
        if (ok) {
          updateMessageStatus(id, tempId, { sendStatus: 'sent', isRead: true });
          notifySent(id, page.id);
        } else {
          updateMessageStatus(id, tempId, { sendStatus: 'failed' });
        }
      }
    };

    for (const block of reply.blocks) {
      await sendBlock(block);
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  const handleRetry = (messageId: string) => {
    const id = convState.selectedId;
    const page = getPage();
    const conv = selectedConv();
    if (!id || !page?.accessToken || !conv) return;
    const list = msgState.messages[id] ?? [];
    const msg = list.find((m) => m.id === messageId);
    if (!msg?.text || msg.sendStatus !== 'failed') return;
    updateMessageStatus(id, messageId, { sendStatus: 'sending' });
    sendMessage(page.accessToken, conv.participant.id, msg.text, page.id).then((ok) => {
      if (ok) {
        updateMessageStatus(id, messageId, { sendStatus: 'sent', isRead: true });
      } else {
        updateMessageStatus(id, messageId, { sendStatus: 'failed' });
      }
    });
  };

  return (
    <div
      class="chat-window-root"
      style={{
        display: 'flex',
        'flex-direction': 'column',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div class="chat-bg-layer" aria-hidden />
      <Show
        when={convState.selectedId}
        fallback={
          <div class="empty-chat-placeholder">
            <div
              style={{
                background: 'rgba(0,0,0,0.2)',
                'border-radius': '16px',
                padding: '12px 24px',
                color: 'rgba(255,255,255,0.95)',
                'font-size': '14px',
                'font-weight': '500',
              }}
            >
              Chọn một cuộc trò chuyện
            </div>
          </div>
        }
      >
        <>
          <header class="chat-topbar chat-topbar--with-back" style={{
            height: '56px', 'min-height': '56px',
            padding: '0 8px 0 16px',
            background: 'var(--color-bg-primary, #ffffff)',
            'border-bottom': '1px solid rgba(0,0,0,0.08)',
            display: 'flex', 'align-items': 'center', gap: '10px',
            'box-shadow': '0 1px 3px rgba(0,0,0,0.06)',
            position: 'relative', 'z-index': '0', 'flex-shrink': '0',
          }}>
            {/* Back button — hiển thị trên mobile */}
            <button
              type="button"
              class="chat-back-btn"
              aria-label="Quay lại danh sách"
              onClick={() => setConvState('selectedId', null)}
              style={{
                width: '40px', height: '40px', 'border-radius': '50%', border: 'none', background: 'none',
                cursor: 'pointer', display: 'none', 'align-items': 'center', 'justify-content': 'center',
                color: '#707579', transition: 'background 150ms, color 150ms', 'flex-shrink': 0,
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            {/* Avatar */}
            <Avatar name={selectedConv()?.participant.name ?? '?'} size={40} avatarUrl={selectedConv()?.participant.avatarUrl} psid={selectedConv()?.participant.id} />

            {/* Info */}
            <div style={{ flex: '1', 'min-width': '0', display: 'flex', 'flex-direction': 'column', 'justify-content': 'center', gap: '1px', cursor: 'pointer' }}>
              <div style={{ 'font-size': '15px', 'font-weight': '600', color: 'var(--color-text-primary, #000)', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap', 'line-height': '1.3' }}>
                {selectedConv()?.participant.name}
              </div>
              <div style={{ 'font-size': '13px', color: '#707579', 'line-height': '1.2', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                <Show when={selectedConv()?.pageName}>
                  <span style={{ color: selectedConv()?.pageColor ?? '#3390ec', 'font-weight': '500' }}>
                    {selectedConv()?.pageName}
                  </span>
                  <span style={{ 'margin-left': '6px' }}>·</span>
                  <span style={{ 'margin-left': '6px' }}>{formatLastSeen(selectedConv()?.lastMessageTime ?? 0)}</span>
                </Show>
                <Show when={!selectedConv()?.pageName}>
                  {formatLastSeen(selectedConv()?.lastMessageTime ?? 0)}
                </Show>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', 'align-items': 'center' }}>
              <button
                type="button"
                title="Tìm kiếm"
                style={{ width: '40px', height: '40px', 'border-radius': '50%', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: '#707579', transition: 'background 150ms, color 150ms' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f3f4'; e.currentTarget.style.color = '#3390ec'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#707579'; }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </button>
              <button
                type="button"
                title="Thêm"
                style={{ width: '40px', height: '40px', 'border-radius': '50%', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: '#707579', transition: 'background 150ms, color 150ms' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f3f4'; e.currentTarget.style.color = '#3390ec'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#707579'; }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>
                </svg>
              </button>
            </div>
          </header>

          <div
            class="chat-area"
            style={{
              flex: 1,
              'min-height': 0,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Scroll ở lề ngoài (full width) - giống Telegram */}
            <div
              ref={(el) => (scrollContainer = el)}
              class="chat-scroll-outer"
              onScroll={() => {
                if (!scrollContainer || msgState.loadingMore) return;
                if (scrollContainer.scrollTop < 100) loadMoreMessages();
              }}
            >
              <div class="chat-content-column chat-scroll-content">
                <Show when={msgState.loading && messages().length === 0}>
                  <div style={{ flex: 1, display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: '#8a8a8a', 'min-height': '120px' }}>
                    Loading...
                  </div>
                </Show>
                <div class="message-list-inner">
                  <For each={displayMessages()}>
                    {(msg, i) => {
                      const list = displayMessages();
                      const idx = i();
                      const dateLabel = shouldShowDate(list, idx);
                      return (
                        <>
                          {dateLabel != null && <DateSeparator label={dateLabel} />}
                          <MessageBubble
                            message={msg}
                            position={getBubblePosition(list, idx)}
                            token={getPage()?.accessToken}
                            onRetry={handleRetry}
                          />
                        </>
                      );
                    }}
                  </For>
                  <div id="messages-bottom" style={{ height: '1px' }} />
                </div>
              </div>
            </div>
            <div class="chat-content-column" style={{ 'flex-shrink': 0 }}>
              <MessageInput
                pageId={selectedConv()?.pageId}
                onSend={handleSend}
                onQuickReply={sendQuickReply}
                disabled={msgState.loading}
              />
            </div>
          </div>
        </>
      </Show>
    </div>
  );
};
