import { createSignal, createEffect, For, Show, onMount } from 'solid-js';
import { IconImage } from '../shared/Icons';
import type { MessageData, MessageMedia } from '../../types/message';
import { MediaRenderer } from './MediaRenderer';
import { fetchMessageAttachments } from '../../services/fbMessageService';
import { Avatar } from '../shared/Avatar';

export type BubblePosition = 'single' | 'first' | 'middle' | 'last';

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function LazyAttachments(props: { messageId: string; token: string }) {
  const [medias, setMedias] = createSignal<MessageMedia[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);

  const loadMedia = async () => {
    if (loaded() || loading()) return;
    const rateLimitedUntil = Number(localStorage.getItem('rate_limited_until') || 0);
    if (Date.now() < rateLimitedUntil) return;
    setLoading(true);
    const list = await fetchMessageAttachments(props.messageId, props.token);
    setMedias(list);
    setLoaded(true);
    setLoading(false);
  };

  onMount(() => {
    loadMedia();
  });

  return (
    <Show
      when={loaded()}
      fallback={
        <div
          role="button"
          tabIndex={0}
          onClick={loadMedia}
          onKeyDown={(e) => e.key === 'Enter' && loadMedia()}
          style={{
            width: '200px', height: '120px',
            background: 'rgba(0,0,0,0.06)',
            'border-radius': '8px',
            display: 'flex', 'flex-direction': 'column',
            'align-items': 'center', 'justify-content': 'center',
            cursor: 'pointer', gap: '8px',
          }}
        >
          {loading()
            ? <span style={{ 'font-size': '13px', color: 'rgba(0,0,0,0.45)' }}>Đang tải ảnh...</span>
            : <><span style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}><IconImage size={32} /></span><span style={{ 'font-size': '12px', color: 'rgba(0,0,0,0.4)' }}>Nhấn để tải lại</span></>
          }
        </div>
      }
    >
      <For each={medias()}>
        {(media) => (
          <MediaRenderer
            media={media}
            pageToken={props.token}
            messageId={props.messageId}
          />
        )}
      </For>
    </Show>
  );
}

export interface Props {
  message: MessageData;
  position: BubblePosition;
  token?: string;
  onRetry?: (messageId: string) => void;
}

export const MessageBubble = (props: Props) => {
  const msg = () => props.message;
  const isOut = () => msg().isFromPage;
  const pos = () => props.position;

  const mediasList = () => {
    const m = msg().medias;
    if (m && m.length > 0) return m;
    const single = msg().media;
    return single ? [single] : [];
  };

  const hasAttachment = () => msg().hasAttachment === true;
  const isMediaOnly = () => !msg().text && (mediasList().length > 0 || hasAttachment());

  // Khoảng cách giữa bubble groups
  const marginTop = () => {
    const p = pos();
    return p === 'single' || p === 'first' ? '6px' : '2px';
  };

  const StatusIcon = () => {
    const status = msg().sendStatus;
    if (status === 'sending') {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12,6 12,12 16,14"/>
        </svg>
      );
    }
    if (status === 'failed') {
      return (
        <span
          role="button"
          tabIndex={0}
          onClick={() => props.onRetry?.(msg().id)}
          onKeyDown={(e) => e.key === 'Enter' && props.onRetry?.(msg().id)}
          style={{ color: '#e53935', 'font-size': '13px', cursor: 'pointer' }}
          title="Gửi thất bại — nhấn để thử lại"
        >
          ❌
        </span>
      );
    }
    // sent / read — dấu tích thành công dùng màu xanh
    return (
      <span style={{ color: 'var(--color-msg-timestamp)', 'font-size': '13px' }}>
        ✓✓
      </span>
    );
  };

  // Timestamp bar — luôn hiện ở cuối bubble, không dùng float
  const TimestampBar = () => (
    <div style={{
      display: 'flex',
      'justify-content': 'flex-end',
      'align-items': 'center',
      gap: '3px',
      'margin-top': '3px',
    }}>
      <span style={{ 'font-size': '12px', color: 'var(--color-msg-timestamp)', 'white-space': 'nowrap' }}>
        {formatTime(msg().timestamp)}
      </span>
      {isOut() && <StatusIcon />}
    </div>
  );

  // Avatar bên trái cho incoming — chỉ hiện ở last/single
  const showAvatar = () => pos() === 'last' || pos() === 'single';

  const borderRadius = () => {
    const out = isOut();
    const p = pos();
    if (out) {
      if (p === 'single') return '18px 18px 4px 18px';
      if (p === 'first')  return '18px 18px 4px 18px';
      if (p === 'middle') return '18px 4px 4px 18px';
      if (p === 'last')   return '18px 4px 18px 18px';
    } else {
      if (p === 'single') return '18px 18px 18px 4px';
      if (p === 'first')  return '18px 18px 18px 4px';
      if (p === 'middle') return '4px 18px 18px 4px';
      if (p === 'last')   return '4px 18px 18px 18px';
    }
    return '18px';
  };

  return (
    <div
      class="message-bubble-row"
      style={{
        display: 'flex',
        'justify-content': isOut() ? 'flex-end' : 'flex-start',
        'align-items': 'flex-end',
        gap: '6px',
        padding: '0 12px',
        'margin-top': marginTop(),
      }}
    >
      {/* Avatar slot — chỉ cho incoming */}
      {!isOut() && (
        <div style={{ width: '36px', 'min-width': '36px', 'flex-shrink': 0 }}>
          {showAvatar() && <Avatar name={msg().senderName} size={36} psid={msg().fromId} />}
        </div>
      )}

      <div
        style={{
          'max-width': '78%',
          padding: isMediaOnly() ? '0' : '9px 14px 7px',
          background: isOut() ? 'var(--bubble-bg-outgoing)' : '#ffffff',
          'border-radius': borderRadius(),
          'box-shadow': '0 1px 2px rgba(0,0,0,0.12)',
          overflow: isMediaOnly() ? 'hidden' : 'visible',
          'word-break': 'break-word',
          'white-space': 'pre-wrap',
          'font-size': '16px',
          'line-height': '1.45',
          color: '#000',
        }}
      >
          {msg().text != null && msg().text !== '' && (
            <div
              style={{ 'text-align': 'left' }}
              ref={(el) => {
                if (!el) return;
                createEffect(() => {
                  el.textContent = msg().text ?? '';
                });
              }}
            />
          )}

        <Show when={mediasList().length > 0 || hasAttachment()}>
          <div style={{ 'margin-top': msg().text ? '6px' : '0', display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
            <For each={mediasList()}>
              {(media) => (
                <MediaRenderer
                  media={media}
                  pageToken={props.token}
                  messageId={msg().id}
                />
              )}
            </For>
            <Show when={hasAttachment() && props.token}>
              <LazyAttachments messageId={msg().id} token={props.token!} />
            </Show>
          </div>
        </Show>

        {/* Timestamp — luôn hiện, không dùng float */}
        {isMediaOnly() ? (
          <div style={{
            padding: '4px 10px 6px',
            background: 'rgba(0,0,0,0.08)',
            'border-radius': isOut() ? '0 0 4px 18px' : '0 0 18px 4px',
            display: 'flex', 'justify-content': 'flex-end', 'align-items': 'center', gap: '6px',
          }}>
            <TimestampBar />
          </div>
        ) : (
          <TimestampBar />
        )}
      </div>
    </div>
  );
};
