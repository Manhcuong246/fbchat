import { createSignal, Show, For, createMemo, createEffect } from 'solid-js';
import { IconLightning, IconClose, IconImage } from '../shared/Icons';
import type { QuickReply } from '../../services/quickReplyService';
import { quickReplies, loadQuickReplies } from '../../stores/quickReplyStore';
import { ImageLibrary } from '../library/ImageLibrary';
import type { LibraryImage } from '../../types/library';

export interface Props {
  pageId?: string;
  onSend: (text: string, imageBase64?: string, imageType?: string, libraryImages?: LibraryImage[]) => void;
  onQuickReply?: (reply: QuickReply) => void;
  disabled?: boolean;
}

interface SelectedImage {
  base64: string;
  type: string;
  preview: string;
  name?: string;
}

export const MessageInput = (props: Props) => {
  const [text, setText] = createSignal('');
  const [selectedImages, setSelectedImages] = createSignal<SelectedImage[]>([]);
  const [pendingImages, setPendingImages] = createSignal<LibraryImage[]>([]);
  const [showQuickReplies, setShowQuickReplies] = createSignal(false);
  const [showLibrary, setShowLibrary] = createSignal(false);
  const [isInputFocused, setInputFocused] = createSignal(false);
  const [hoveredToolbar, setHoveredToolbar] = createSignal<string | null>(null);
  const [sendBtnHover, setSendBtnHover] = createSignal(false);
  const [sendBtnActive, setSendBtnActive] = createSignal(false);
  const [dragHandleHover, setDragHandleHover] = createSignal(false);
  let textareaEl: HTMLTextAreaElement | undefined;
  let imageInputEl: HTMLInputElement | undefined;

  const setRef = (el: HTMLTextAreaElement) => {
    textareaEl = el;
    textareaRef.current = el;
  };

  createEffect(() => {
    const pid = props.pageId;
    if (pid) void loadQuickReplies(pid);
  });

  const allReplies = () => quickReplies;
  const slashPrefix = () => {
    const t = text();
    if (!t.startsWith('/')) return null;
    const rest = t.slice(1);
    const space = rest.indexOf(' ');
    return space >= 0 ? rest.slice(0, space) : rest;
  };
  const suggestReplies = createMemo(() => {
    const prefix = slashPrefix();
    const list = allReplies();
    if (!prefix) return list;
    const lower = prefix.toLowerCase();
    return list.filter((r) => r.shortcut.toLowerCase().startsWith(lower));
  });
  const showSuggest = () => slashPrefix() !== null && suggestReplies().length > 0;

  const pickerReplies = () => allReplies();

  const canSend = () =>
    (text().trim().length > 0 || selectedImages().length > 0 || pendingImages().length > 0) && !props.disabled;

  const adjustHeight = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.4) + 'px';
  };

  const clearInputs = () => {
    setText('');
    setSelectedImages([]);
    setPendingImages([]);
    setTimeout(() => textareaEl && adjustHeight(textareaEl), 0);
  };

  const send = () => {
    const value = text().trim();
    const fileImages = selectedImages();
    const libImages = pendingImages();
    if (!value && fileImages.length === 0 && libImages.length === 0) return;
    clearInputs();
    // Gửi text + ảnh library (nhiều ảnh)
    if (libImages.length > 0) {
      props.onSend(value || '', undefined, undefined, libImages);
    }
    // Gửi ảnh từ file picker (flow cũ)
    if (fileImages.length > 0) {
      const textToSend = libImages.length > 0 ? '' : value || '';
      props.onSend(textToSend, fileImages[0]?.base64, fileImages[0]?.type);
      for (let i = 1; i < fileImages.length; i++) {
        props.onSend('', fileImages[i].base64, fileImages[i].type);
      }
    }
    if (libImages.length === 0 && fileImages.length === 0 && value) {
      props.onSend(value);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (showSuggest()) {
      if (e.key === 'Enter') {
        const list = suggestReplies();
        if (list.length > 0) {
          e.preventDefault();
          applyQuickReply(list[0]);
          return;
        }
      }
      if (e.key === 'Escape') {
        setText('');
        return;
      }
    }
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;
    e.preventDefault();
    send();
  };

  const applyQuickReply = (reply: QuickReply) => {
    if (props.onQuickReply) {
      props.onQuickReply(reply);
      setText('');
      setSelectedImages([]);
    } else {
      const firstText = reply.blocks.find((b) => b.type === 'text' && b.text);
      const firstImage = reply.blocks.find((b) => b.type === 'image' && b.imageFile);
      if (firstText?.text) setText(firstText.text);
      if (firstImage?.imageFile) {
        const dataUrl = firstImage.imageFile;
        const mime = dataUrl.match(/^data:([^;]+);/)?.[1] ?? 'image/png';
        setSelectedImages((prev) => [
          ...prev,
          {
            base64: dataUrl,
            type: mime,
            preview: dataUrl,
            name: firstImage.imageName,
          },
        ]);
      }
    }
    setShowQuickReplies(false);
  };

  const handleInput = (e: Event) => {
    setText((e.target as HTMLTextAreaElement).value);
    adjustHeight(e.target as HTMLTextAreaElement);
  };

  const triggerImageInput = () => {
    if (props.disabled) return;
    imageInputEl?.click();
  };

  const handleImageSelect = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setSelectedImages((prev) => [
        ...prev,
        { base64: dataUrl, type: file.type, preview: dataUrl, name: file.name },
      ]);
    };
    reader.readAsDataURL(file);
    (e.target as HTMLInputElement).value = '';
  };

  const removeImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const textareaRef: { current: HTMLTextAreaElement | undefined } = { current: undefined };
  const dragState = { isDragging: false, startY: 0, startHeight: 0 };

  const handleDragStart = (e: MouseEvent) => {
    if (props.disabled) return;
    dragState.isDragging = true;
    dragState.startY = e.clientY;
    dragState.startHeight = textareaRef.current?.offsetHeight ?? 44;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragState.isDragging || !textareaRef.current) return;
      const delta = dragState.startY - ev.clientY;
      const newHeight = Math.max(44, Math.min(dragState.startHeight + delta, window.innerHeight * 0.4));
      textareaRef.current.style.height = newHeight + 'px';
    };

    const handleMouseUp = () => {
      dragState.isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const hasText = () => canSend();
  const toolbarBtnStyle = (key: string) => ({
    width: '36px',
    height: '36px',
    'border-radius': '50%',
    border: 'none',
    background: hoveredToolbar() === key && !props.disabled ? '#f1f3f4' : 'none',
    cursor: props.disabled ? 'default' : 'pointer',
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    color: hoveredToolbar() === key && !props.disabled ? '#3390ec' : '#707579',
    transition: 'background 150ms, color 150ms',
    'flex-shrink': '0',
  });

  const hasPopupOpen = () => showQuickReplies() || showLibrary() || showSuggest();

  return (
    <div
      class="message-input-wrapper"
      style={{
        background: '#ffffff',
        'border-top': '1px solid rgba(0,0,0,0.08)',
        padding: '10px 16px 12px',
        display: 'flex',
        'flex-direction': 'column',
        gap: '8px',
        'flex-shrink': '0',
        'max-height': '50vh',
        overflow: hasPopupOpen() ? 'visible' : 'hidden',
      }}
    >
      {/* Library images preview */}
      <Show when={pendingImages().length > 0}>
        <div
          style={{
            padding: '8px 12px',
            'border-bottom': '1px solid rgba(0,0,0,0.08)',
            display: 'flex',
            gap: '8px',
            'overflow-x': 'auto',
            'flex-shrink': '0',
            'flex-wrap': 'nowrap',
            background: '#f8f9fa',
          }}
        >
          <For each={pendingImages()}>
            {(img, i) => (
              <div style={{ position: 'relative', 'flex-shrink': '0' }}>
                <img
                  src={img.url}
                  alt=""
                  style={{
                    width: '56px',
                    height: '56px',
                    'object-fit': 'cover',
                    'border-radius': '8px',
                    display: 'block',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setPendingImages((prev) => prev.filter((_, idx) => idx !== i()))}
                  aria-label="Xóa ảnh"
                  style={{
                    position: 'absolute',
                    top: '-5px',
                    right: '-5px',
                    width: '18px',
                    height: '18px',
                    'border-radius': '50%',
                    background: '#e53935',
                    color: 'white',
                    border: 'none',
                    cursor: 'pointer',
                    'font-size': '11px',
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': 'center',
                  }}
                ><IconClose size={14} /></button>
              </div>
            )}
          </For>
          <button
            type="button"
            onClick={() => setPendingImages([])}
            style={{
              padding: '4px 10px',
              border: '1px solid var(--color-border)',
              'border-radius': '6px',
              background: 'none',
              cursor: 'pointer',
              'font-size': '12px',
              color: '#707579',
              'flex-shrink': '0',
            }}
          >Xóa tất cả</button>
        </div>
      </Show>

      {/* Drag handle */}
      <div
        style={{
          width: '100%',
          height: '4px',
          cursor: 'ns-resize',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          'margin-bottom': '2px',
        }}
        onMouseDown={handleDragStart}
        onMouseEnter={() => setDragHandleHover(true)}
        onMouseLeave={() => setDragHandleHover(false)}
        role="button"
        tabIndex={0}
        aria-label="Kéo để thay đổi kích thước"
      >
        <div
          style={{
            width: '36px',
            height: '3px',
            background: dragHandleHover() ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.1)',
            'border-radius': '2px',
            transition: 'background 150ms',
          }}
        />
      </div>

      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '2px',
          padding: '0 4px',
        }}
      >
        <button type="button" onClick={triggerImageInput} title="Đính kèm" disabled={props.disabled} style={toolbarBtnStyle('attach')} onMouseEnter={() => setHoveredToolbar('attach')} onMouseLeave={() => setHoveredToolbar(null)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <button type="button" onClick={triggerImageInput} title="Gửi ảnh" disabled={props.disabled} style={toolbarBtnStyle('photo')} onMouseEnter={() => setHoveredToolbar('photo')} onMouseLeave={() => setHoveredToolbar(null)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg>
        </button>
        <button type="button" class={showQuickReplies() ? 'active' : ''} onClick={() => setShowQuickReplies((v) => !v)} title="Tin nhắn nhanh" disabled={props.disabled} style={toolbarBtnStyle('quickreply')} onMouseEnter={() => setHoveredToolbar('quickreply')} onMouseLeave={() => setHoveredToolbar(null)}>
          <IconLightning size={18} />
        </button>
        <Show when={props.pageId}>
          <button type="button" onClick={() => setShowLibrary(true)} title="Thư viện ảnh" disabled={props.disabled} style={toolbarBtnStyle('library')} onMouseEnter={() => setHoveredToolbar('library')} onMouseLeave={() => setHoveredToolbar(null)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          </button>
        </Show>
        <button type="button" title="Emoji" disabled style={{ ...toolbarBtnStyle('emoji'), opacity: 0.4 }} onMouseEnter={() => setHoveredToolbar('emoji')} onMouseLeave={() => setHoveredToolbar(null)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
        </button>
      </div>

      <input ref={(el) => (imageInputEl = el)} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageSelect} />

      {/* Image preview (file picker) */}
      <Show when={selectedImages().length > 0}>
        <div class="image-preview-wrapper" style={{ 'flex-shrink': '0' }}>
          <For each={selectedImages()}>
            {(img, i) => (
              <div class="image-preview-item">
                <img src={img.preview} alt="" />
                <button type="button" class="image-preview-remove" onClick={() => removeImage(i())} aria-label="Xóa ảnh"><IconClose size={12} /></button>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Textarea row: textarea container + send button */}
      <div
        style={{
          display: 'flex',
          'align-items': 'flex-end',
          gap: '10px',
        }}
      >
        <div
          style={{
            flex: '1',
            background: isInputFocused() ? '#ffffff' : '#f1f3f4',
            'border-radius': '22px',
            padding: '10px 16px',
            display: 'flex',
            'align-items': 'flex-end',
            'min-height': '44px',
            'max-height': '200px',
            transition: 'background 150ms',
            border: isInputFocused() ? '1.5px solid #3390ec' : '1.5px solid transparent',
            'box-shadow': isInputFocused() ? '0 0 0 3px rgba(51,144,236,0.1)' : 'none',
          }}
        >
          <textarea
            ref={setRef}
            class="message-textarea message-input-placeholder"
            placeholder="Nhập tin nhắn... (gõ / để dùng tin nhắn nhanh)"
            value={text()}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            rows={1}
            disabled={props.disabled}
            style={{
              flex: '1',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              'font-size': '15px',
              'line-height': '1.5',
              color: '#000',
              resize: 'none',
              'min-height': '24px',
              'max-height': '160px',
              'overflow-y': 'auto',
              'font-family': 'inherit',
              padding: '0',
            }}
          />
        </div>
        <button
          type="button"
          disabled={!hasText()}
          onClick={send}
          aria-label="Gửi"
          onMouseEnter={() => setSendBtnHover(true)}
          onMouseLeave={() => { setSendBtnHover(false); setSendBtnActive(false); }}
          onMouseDown={() => setSendBtnActive(true)}
          onMouseUp={() => setSendBtnActive(false)}
          style={{
            width: '44px',
            height: '44px',
            'min-width': '44px',
            'border-radius': '50%',
            border: 'none',
            background: hasText() ? '#3390ec' : '#e8e8e8',
            color: hasText() ? 'white' : '#b0b0b0',
            cursor: hasText() ? 'pointer' : 'default',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            transition: 'background 200ms, transform 100ms',
            'flex-shrink': '0',
            'box-shadow': hasText() ? '0 2px 8px rgba(51,144,236,0.35)' : 'none',
            transform: hasText() && sendBtnActive() ? 'scale(0.93)' : hasText() && sendBtnHover() ? 'scale(1.05)' : 'scale(1)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22,2 15,22 11,13 2,9"/></svg>
        </button>
      </div>

      {/* Slash suggest dropdown */}
      <Show when={showSuggest()}>
        <div
          class="quick-reply-popup"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            'margin-bottom': '4px',
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border)',
            'border-radius': '12px 12px 0 0',
            'box-shadow': '0 -4px 20px rgba(0,0,0,0.1)',
            'max-height': '200px',
            overflow: 'auto',
            'z-index': 100,
          }}
        >
          <For each={suggestReplies()}>
            {(reply) => (
              <button
                type="button"
                class="quick-reply-item"
                onClick={() => applyQuickReply(reply)}
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: '10px',
                  width: '100%',
                  padding: '10px 12px',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  'font-size': '14px',
                  color: 'var(--color-text-primary)',
                  'text-align': 'left',
                }}
              >
                <span style={{ color: 'var(--color-primary)', 'font-weight': '600', 'white-space': 'nowrap' }}>
                  /{reply.shortcut}
                </span>
                <span style={{ flex: 1, overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                  {reply.blocks.some((b) => b.type === 'image') && (
                    <span style={{ display: 'inline-flex', 'align-items': 'center', 'margin-right': '4px' }}><IconImage size={14} /></span>
                  )}
                  {reply.blocks.find((b) => b.type === 'text')?.text || '[Chỉ hình ảnh]'}
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Library picker */}
      <Show when={showLibrary() && props.pageId}>
        <ImageLibrary
          pageId={props.pageId!}
          mode="pick"
          onClose={() => setShowLibrary(false)}
          onSelectMultiple={(imgs) => {
            setPendingImages((prev) => [...prev, ...imgs]);
            setShowLibrary(false);
          }}
        />
      </Show>

      {/* Quick reply picker popup */}
      <Show when={showQuickReplies()}>
        <div
          class="quick-reply-popup"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            background: 'white',
            'border-radius': '12px 12px 0 0',
            'box-shadow': '0 -4px 20px rgba(0,0,0,0.1)',
            'border-top': '1px solid var(--color-border)',
            'max-height': '280px',
            'overflow-y': 'auto',
            'z-index': 101,
          }}
        >
          <div
            style={{
              padding: '10px 12px',
              'border-bottom': '1px solid var(--color-border)',
              display: 'flex',
              'justify-content': 'space-between',
              'align-items': 'center',
            }}
          >
            <span style={{ 'font-weight': '600', 'font-size': '14px', display: 'flex', 'align-items': 'center', gap: '6px' }}><IconLightning size={16} /> Tin nhắn nhanh</span>
            <button
              type="button"
              onClick={() => setShowQuickReplies(false)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                'font-size': '18px',
                color: 'var(--color-text-secondary)',
              }}
            >
              <IconClose size={16} />
            </button>
          </div>
          <div style={{ overflow: 'auto', flex: 1, 'max-height': '220px' }}>
            <For each={pickerReplies()}>
              {(reply) => (
                <button
                  type="button"
                  class="quick-reply-item"
                  onClick={() => applyQuickReply(reply)}
                  style={{
                    display: 'flex',
                    'align-items': 'center',
                    gap: '10px',
                    width: '100%',
                    padding: '10px 12px',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    'font-size': '14px',
                    color: 'var(--color-text-primary)',
                    'text-align': 'left',
                  }}
                >
                  <span style={{ color: 'var(--color-primary)', 'font-weight': '600', 'white-space': 'nowrap' }}>
                    /{reply.shortcut}
                  </span>
                  {reply.blocks.some((b) => b.type === 'image' && b.imageFile) && (
                    <img
                      src={reply.blocks.find((b) => b.type === 'image' && b.imageFile)!.imageFile!}
                      alt=""
                      style={{
                        width: '28px',
                        height: '28px',
                        'object-fit': 'cover',
                        'border-radius': '4px',
                      }}
                    />
                  )}
                  <span style={{ flex: 1, overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                    {reply.blocks.find((b) => b.type === 'text')?.text || '[Chỉ hình ảnh]'}
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};
