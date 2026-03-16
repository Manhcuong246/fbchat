import { createSignal, For, Show, onMount } from 'solid-js';
import { IconImage } from '../shared/Icons';
import type { MessageData, MessageMedia } from '../../types/message';
import { MediaRenderer } from './MediaRenderer';
import { fetchMessageAttachments } from '../../services/fbMessageService';
import { Avatar } from '../shared/Avatar';
import { toHighResStickerUrl } from '../../utils/stickerUrl';

export type BubblePosition = 'single' | 'first' | 'middle' | 'last';

const PROXY_BASE = 'http://localhost:3001';

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function getImageUrl(media: MessageMedia): string {
  const raw = media.type === 'sticker' ? toHighResStickerUrl(media.url) : (media.url ?? '');
  if (!raw) return '';
  if (raw.startsWith('http://localhost') || raw.startsWith('/')) return raw;
  if (raw.includes('fbcdn.net') || raw.includes('facebook.com')) {
    return `${PROXY_BASE}/api/image?url=${encodeURIComponent(raw)}`;
  }
  return raw;
}

const PLACEHOLDER_IMG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect fill="%23e5e7eb" width="120" height="120"/></svg>'
);

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

  const isImageOnly = () =>
    !msg().text &&
    mediasList().length > 0 &&
    mediasList().every((a) => a.type === 'image' || a.type === 'sticker');

  const marginTop = () => (pos() === 'single' || pos() === 'first' ? '6px' : '2px');

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
    return (
      <span style={{ color: 'var(--color-msg-timestamp)', 'font-size': '13px' }}>✓✓</span>
    );
  };

  const showAvatar = () => pos() === 'last' || pos() === 'single';

  const borderRadius = () => {
    const out = isOut();
    const p = pos();
    if (out) {
      if (p === 'single') return '18px 18px 4px 18px';
      if (p === 'first') return '18px 18px 4px 18px';
      if (p === 'middle') return '18px 4px 4px 18px';
      if (p === 'last') return '18px 4px 18px 18px';
    } else {
      if (p === 'single') return '18px 18px 18px 4px';
      if (p === 'first') return '18px 18px 18px 4px';
      if (p === 'middle') return '4px 18px 18px 4px';
      if (p === 'last') return '4px 18px 18px 18px';
    }
    return '18px';
  };

  const openImageViewer = (url: string) => {
    const proxied = url.includes('fbcdn.net') || url.includes('facebook.com')
      ? `${PROXY_BASE}/api/image?url=${encodeURIComponent(url)}`
      : url;
    window.open(proxied, '_blank');
  };

  const firstMedia = () => mediasList()[0];
  const firstMediaUrl = () => {
    const m = firstMedia();
    return m ? getImageUrl(m) : '';
  };

  const ImageOnlyMessage = () => {
    const media = firstMedia();
    const url = firstMediaUrl();
    const hasUrl = () => !!media?.url || !!url;
    return (
      <div
        style={{
          position: 'relative',
          display: 'inline-block',
          'max-width': '180px',
          'border-radius': '18px',
          overflow: 'hidden',
          cursor: 'pointer',
          'box-shadow': '0 1px 4px rgba(0,0,0,0.18)',
        }}
      >
        <Show
          when={hasUrl()}
          fallback={
            media && props.token ? (
              <div style={{ 'border-radius': '18px', overflow: 'hidden' }}>
                <MediaRenderer
                  media={media}
                  pageToken={props.token}
                  messageId={msg().id}
                  preferStickerSize={true}
                />
              </div>
            ) : null
          }
        >
          <img
            src={url || PLACEHOLDER_IMG}
            alt=""
            style={{
              display: 'block',
              width: '100%',
              'max-width': '180px',
              'min-width': '80px',
              height: 'auto',
              'border-radius': '18px',
            }}
            onClick={() => media && (media.url || url) && openImageViewer(media.url || url)}
            onError={(e) => { e.currentTarget.src = PLACEHOLDER_IMG; }}
          />
        </Show>

        <Show when={mediasList().length > 1}>
          <div
            style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              background: 'rgba(0,0,0,0.55)',
              color: 'white',
              'font-size': '12px',
              'font-weight': 600,
              padding: '2px 8px',
              'border-radius': '99px',
            }}
          >
            +{mediasList().length - 1}
          </div>
        </Show>

        <div
          style={{
            position: 'absolute',
            bottom: '6px',
            right: '10px',
            display: 'flex',
            'align-items': 'center',
            gap: '4px',
            background: 'rgba(0,0,0,0.38)',
            'border-radius': '99px',
            padding: '2px 7px',
            'pointer-events': 'none',
          }}
        >
          <span style={{ 'font-size': '11px', color: 'rgba(255,255,255,0.92)', 'line-height': 1.4 }}>
            {formatTime(msg().timestamp)}
          </span>
          <Show when={isOut()}>
            <span style={{ 'font-size': '11px', color: 'rgba(255,255,255,0.85)' }}>✓✓</span>
          </Show>
        </div>
      </div>
    );
  };

  const ReplyQuote = () => (
    <Show when={msg().replyToId}>
      <div
        style={{
          'margin-bottom': '4px',
          'padding-left': '8px',
          'border-left': '3px solid rgba(0,0,0,0.2)',
          'font-size': '12px',
          color: 'rgba(0,0,0,0.6)',
          'white-space': 'nowrap',
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
        }}
      >
        {msg().replyToText || 'Tin nhắn đã trích dẫn'}
      </div>
    </Show>
  );

  const NormalBubble = () => (
    <div
      style={{
        'max-width': '70%',
        background: isOut() ? 'var(--bubble-bg-outgoing)' : 'white',
        color: isOut() ? 'var(--bubble-text-outgoing)' : '#111827',
        'border-radius': borderRadius(),
        padding: '8px 12px',
        'box-shadow': '0 1px 2px rgba(0,0,0,0.08)',
        position: 'relative',
      }}
    >
      <ReplyQuote />
      <Show when={msg().text != null && msg().text !== ''}>
        <span style={{ 'font-size': '14px', 'line-height': 1.5, 'white-space': 'pre-wrap', 'word-break': 'break-word' }}>
          {msg().text}
        </span>
      </Show>
      <Show when={mediasList().length > 0 || hasAttachment()}>
        <div style={{ 'margin-top': msg().text ? '6px' : '0', display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
          <For each={mediasList()}>
            {(media) => (
              <MediaRenderer
                media={media}
                pageToken={props.token}
                messageId={msg().id}
                preferStickerSize={isMediaOnly() && mediasList().length === 1}
              />
            )}
          </For>
          <Show when={hasAttachment() && props.token}>
            <LazyAttachments messageId={msg().id} token={props.token!} />
          </Show>
        </div>
      </Show>
      <span
        style={{
          display: 'inline-flex',
          'align-items': 'center',
          gap: '3px',
          'margin-left': '8px',
          'vertical-align': 'bottom',
          'white-space': 'nowrap',
        }}
      >
        <span
          style={{
            'font-size': '11px',
            color: isOut() ? 'var(--color-msg-timestamp)' : '#9ca3af',
            'line-height': 1,
          }}
        >
          {formatTime(msg().timestamp)}
        </span>
        <Show when={isOut()}>
          <StatusIcon />
        </Show>
      </span>
    </div>
  );

  return (
    <div
      id={`msg-${msg().id}`}
      class="message-bubble-row"
      style={{
        display: 'flex',
        'justify-content': isOut() ? 'flex-end' : 'flex-start',
        padding: '2px 16px',
        'align-items': 'flex-end',
        gap: '6px',
        'margin-top': marginTop(),
      }}
    >
      {!isOut() && (
        <div style={{ width: '28px', 'min-width': '28px', 'flex-shrink': 0 }}>
          <Show when={!isImageOnly() && showAvatar()}>
            <Avatar name={msg().senderName} size={28} psid={msg().fromId} />
          </Show>
        </div>
      )}

      <Show when={isImageOnly()} fallback={<NormalBubble />}>
        <ImageOnlyMessage />
      </Show>
    </div>
  );
};
