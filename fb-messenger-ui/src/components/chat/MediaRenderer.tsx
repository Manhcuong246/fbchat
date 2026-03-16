import { createSignal, Switch, Match, onMount, Show } from 'solid-js';
import { IconImage } from '../shared/Icons';
import type { MessageMedia } from '../../types/message';
import { toHighResStickerUrl } from '../../utils/stickerUrl';

const PROXY_BASE = 'http://localhost:3001';

function proxyImageUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (url.includes('fbcdn.net') || url.includes('facebook.com')) {
    return `${PROXY_BASE}/api/image?url=${encodeURIComponent(url)}`;
  }
  return url;
}

/** Ảnh cần fetch qua server khi chỉ có attachmentId. */
function FetchableImage(props: {
  messageId: string;
  attachmentId: string;
  pageToken: string;
}) {
  const [url, setUrl] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    try {
      const res = await fetch(
        `${PROXY_BASE}/api/attachments/${props.messageId}?token=${encodeURIComponent(props.pageToken)}`
      );
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data = (await res.json()) as { data?: Array<Record<string, unknown>> };
      const att = data.data?.find((a) => a.id === props.attachmentId) as Record<string, unknown> | undefined;
      const first = data.data?.[0] as Record<string, unknown> | undefined;
      const item = att ?? first;
      const imageData = item?.image_data as { url?: string } | undefined;
      const videoData = item?.video_data as { url?: string } | undefined;
      const fileUrl = item?.file_url as string | undefined;
      const imgUrl = imageData?.url ?? videoData?.url ?? fileUrl ?? null;
      setUrl(imgUrl);
    } catch {
      /* ignore */
    }
    setLoading(false);
  });

  return (
    <Show
      when={!loading()}
      fallback={
        <div
          style={{
            width: '200px',
            height: '120px',
            background: 'rgba(0,0,0,0.05)',
            'border-radius': '8px',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'font-size': '13px',
            color: '#707579',
          }}
        >
          Đang tải...
        </div>
      }
    >
      <Show
        when={url()}
        fallback={
          <div
            style={{
              padding: '8px 12px',
              background: 'rgba(0,0,0,0.05)',
              'border-radius': '8px',
              'font-size': '13px',
              color: '#707579',
              display: 'flex',
              'align-items': 'center',
              gap: '6px',
            }}
          >
            <IconImage size={20} />
            Không tải được ảnh
          </div>
        }
      >
        <img
          src={proxyImageUrl(url()!)}
          alt=""
          onError={(e) => {
            if (url()) e.currentTarget.src = url()!;
          }}
          style={{
            'max-width': '280px',
            'max-height': '320px',
            'border-radius': '8px',
            display: 'block',
            cursor: 'pointer',
          }}
          loading="lazy"
          onClick={() => window.open(url()!, '_blank')}
        />
      </Show>
    </Show>
  );
}

export const MediaRenderer = (props: {
  media: MessageMedia;
  pageToken?: string;
  messageId?: string;
  /** Khi true: media-only (1 ảnh/sticker) dùng kích thước lớn */
  preferStickerSize?: boolean;
}) => {
  const [resolvedUrl, setResolvedUrl] = createSignal<string | null>(props.media.url ?? null);
  const [resolvedType, setResolvedType] = createSignal<string | null>(props.media.type === 'pending' ? null : props.media.type);
  const [loading, setLoading] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [imgError, setImgError] = createSignal(false);
  const [videoError, setVideoError] = createSignal(false);

  const media = () => props.media;

  const displayUrl = () => {
    const u = resolvedUrl() ?? props.media.url;
    if (!u) return null;
    return proxyImageUrl(u);
  };

  onMount(async () => {
    if (props.media.url) {
      setResolvedUrl(props.media.url);
      return;
    }
    if (props.media.attachmentId && props.pageToken && props.messageId) {
      setLoading(true);
      try {
        const res = await fetch(
          `${PROXY_BASE}/api/attachments/${props.messageId}?token=${encodeURIComponent(props.pageToken)}`
        );
        if (!res.ok) {
          setFailed(true);
          return;
        }
        const data = (await res.json()) as { data?: Array<Record<string, unknown>> };
        const att = data.data?.find((a) => a.id === props.media.attachmentId) as Record<string, unknown> | undefined;
        const first = data.data?.[0] as Record<string, unknown> | undefined;
        const item = att ?? first;
        const imageData = item?.image_data as { url?: string } | undefined;
        const videoData = item?.video_data as { url?: string } | undefined;
        const fileUrl = item?.file_url as string | undefined;
        const url = imageData?.url ?? videoData?.url ?? fileUrl ?? null;
        const type = imageData?.url ? 'image' : videoData?.url ? 'video' : fileUrl ? 'file' : null;
        if (url) {
          setResolvedUrl(url);
          if (type) setResolvedType(type);
        } else {
          setFailed(true);
        }
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    } else if (props.media.attachmentId && (!props.pageToken || !props.messageId)) {
      setFailed(true);
    }
  });

  if (!media()) return null;

  return (
    <Switch fallback={null}>
      <Match when={loading()}>
        <div
          style={{
            width: '200px',
            height: '120px',
            background: 'rgba(0,0,0,0.05)',
            'border-radius': '8px',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            color: '#707579',
            'font-size': '13px',
          }}
        >
          Đang tải ảnh...
        </div>
      </Match>

      <Match when={failed() && !resolvedUrl()}>
        <div
          style={{
            padding: '8px 12px',
            background: 'rgba(0,0,0,0.05)',
            'border-radius': '8px',
            'font-size': '13px',
            color: '#707579',
            display: 'flex',
            'align-items': 'center',
            gap: '6px',
          }}
        >
          <IconImage size={20} />
          Không tải được ảnh
        </div>
      </Match>

      <Match when={(media()!.type === 'image' || resolvedType() === 'image') && (displayUrl() || (props.media.attachmentId && props.messageId && props.pageToken))}>
        <Show
          when={displayUrl() && !imgError()}
          fallback={
            props.media.attachmentId && props.messageId && props.pageToken ? (
              <FetchableImage
                messageId={props.messageId}
                attachmentId={props.media.attachmentId}
                pageToken={props.pageToken}
              />
            ) : null
          }
        >
          <div
            class={props.preferStickerSize ? 'sticker-container' : undefined}
            style={{
              'border-radius': '8px',
              overflow: 'hidden',
              cursor: 'pointer',
              ...(props.preferStickerSize
                ? { padding: '8px', flexShrink: 0, display: 'inline-flex', 'align-items': 'center', 'justify-content': 'center' }
                : { 'max-width': '260px', 'max-height': '340px', display: 'flex', 'align-items': 'center', 'justify-content': 'center' }),
            }}
            onClick={() => window.open(displayUrl()!, '_blank')}
          >
            <img
              src={displayUrl()!}
              alt=""
              class={props.preferStickerSize ? 'sticker-img' : undefined}
              onError={() => setImgError(true)}
              style={{
                ...(props.preferStickerSize
                  ? { width: '180px', height: '180px', 'object-fit': 'contain', display: 'block', 'border-radius': '8px', imageRendering: 'crisp-edges' }
                  : { 'max-width': '100%', 'max-height': '340px', width: 'auto', height: 'auto', display: 'block', 'object-fit': 'contain', 'border-radius': '8px', 'vertical-align': 'middle' }),
              }}
              loading="lazy"
            />
          </div>
        </Show>
      </Match>

      <Match when={media()!.type === 'sticker' && (resolvedUrl() || media()!.url)}>
        <div
          class="sticker-container"
          style={{
            padding: '8px',
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <img
            src={proxyImageUrl(toHighResStickerUrl(resolvedUrl() || media()!.url))}
            alt=""
            class="sticker-img"
            style={{
              width: '180px',
              height: '180px',
              objectFit: 'contain',
              display: 'block',
              imageRendering: 'crisp-edges',
            }}
            loading="lazy"
          />
        </div>
      </Match>

      <Match when={(media()!.type === 'video' || resolvedType() === 'video') && (resolvedUrl() || media()!.url) && !videoError()}>
        <div style={{ 'border-radius': '8px', overflow: 'hidden' }}>
          <video
            controls
            preload="metadata"
            onError={() => setVideoError(true)}
            style={{ 'max-width': '280px', 'max-height': '200px', display: 'block', 'border-radius': '8px' }}
          >
            <source src={resolvedUrl() || media()!.url!} />
          </video>
        </div>
      </Match>

      <Match when={media()!.type === 'audio' && (resolvedUrl() || media()!.url)}>
        <audio controls preload="metadata" style={{ 'max-width': '280px' }}>
          <source src={resolvedUrl() || media()!.url!} />
        </audio>
      </Match>

      <Match when={(media()!.type === 'file' || resolvedType() === 'file') && resolvedUrl()}>
        <a
          href={resolvedUrl()!}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            padding: '10px 12px',
            background: 'rgba(0,0,0,0.05)',
            'border-radius': '8px',
            'text-decoration': 'none',
            color: 'var(--color-text-primary)',
            'font-size': '14px',
          }}
        >
          <span style={{ 'font-size': '24px' }}>📄</span>
          <span style={{ overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap', 'max-width': '200px' }}>
            {media()!.filename || 'Tệp đính kèm'}
          </span>
        </a>
      </Match>

      <Match when={media()!.type === 'file' && media()!.url}>
        <a
          href={media()!.url!}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            padding: '10px 12px',
            background: 'rgba(0,0,0,0.05)',
            'border-radius': '8px',
            'text-decoration': 'none',
            color: 'var(--color-text-primary)',
            'font-size': '14px',
          }}
        >
          <span style={{ 'font-size': '24px' }}>📄</span>
          <span style={{ overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap', 'max-width': '200px' }}>
            {media()!.filename || 'Tệp đính kèm'}
          </span>
        </a>
      </Match>

      <Match when={media()!.type === 'fallback' && media()!.title}>
        <div
          style={{
            padding: '8px 12px',
            background: 'rgba(255,193,7,0.15)',
            'border-left': '3px solid #ffc107',
            'border-radius': '4px',
            'font-size': '13px',
            color: 'var(--color-text-secondary)',
          }}
        >
          {media()!.title}
        </div>
      </Match>

      <Match when={media()!.type === 'share' && (resolvedUrl() || media()!.url)}>
        <a
          href={resolvedUrl() || media()!.url!}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            padding: '8px 12px',
            background: 'rgba(42,171,238,0.1)',
            'border-radius': '8px',
            'text-decoration': 'none',
            color: 'var(--color-primary)',
            'font-size': '13px',
          }}
        >
          🔗 Xem liên kết
        </a>
      </Match>

      <Match when={media()!.type === 'image' && imgError()}>
        <div
          style={{
            padding: '8px 12px',
            background: 'rgba(0,0,0,0.05)',
            'border-radius': '8px',
            'font-size': '13px',
            color: 'var(--color-text-secondary)',
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
          }}
        >
          <IconImage size={20} />
          <span>Không tải được ảnh</span>
        </div>
      </Match>
    </Switch>
  );
};
