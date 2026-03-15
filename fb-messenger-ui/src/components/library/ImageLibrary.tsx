import { createSignal, For, Show, onMount } from 'solid-js';
import { IconSearch, IconClose, IconCheck, IconImage, IconFolder } from '../shared/Icons';
import { LibraryService } from '../../services/libraryService';
import type { LibraryImage } from '../../types/library';

interface Props {
  pageId: string;
  onSelect?: (image: LibraryImage) => void;
  onSelectMultiple?: (images: LibraryImage[]) => void;
  onClose: () => void;
  mode: 'manage' | 'pick';
  /** Render inline without fixed overlay (for use inside modals/settings) */
  embedded?: boolean;
}

export const ImageLibrary = (props: Props) => {
  const [images, setImages] = createSignal<LibraryImage[]>([]);
  const [total, setTotal] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [uploadProgress, setUploadProgress] = createSignal(0);
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set<string>());
  const [searchQuery, setSearchQuery] = createSignal('');
  const [stats, setStats] = createSignal({ count: 0, totalSizeMB: '0' });
  const [dragOver, setDragOver] = createSignal(false);

  let searchTimeout: ReturnType<typeof setTimeout>;

  const loadImages = async (search = '', offset = 0, append = false) => {
    setLoading(true);
    const data = await LibraryService.getImages(props.pageId, search, offset);
    if (append) {
      setImages((prev) => [...prev, ...data.items]);
    } else {
      setImages(data.items);
    }
    setTotal(data.total);
    setLoading(false);
  };

  const loadStats = async () => {
    const s = await LibraryService.getStats(props.pageId);
    setStats(s);
  };

  onMount(() => {
    loadImages();
    loadStats();
  });

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadImages(q), 300);
  };

  const handleUpload = async (files: FileList | File[]) => {
    const fileArr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (fileArr.length === 0) return;
    setUploading(true);
    setUploadProgress(0);
    const batchSize = 5;
    let uploaded = 0;
    for (let i = 0; i < fileArr.length; i += batchSize) {
      const batch = fileArr.slice(i, i + batchSize);
      await LibraryService.uploadImages(props.pageId, batch);
      uploaded += batch.length;
      setUploadProgress(Math.round((uploaded / fileArr.length) * 100));
    }
    setUploading(false);
    setUploadProgress(0);
    await loadImages(searchQuery());
    await loadStats();
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files) await handleUpload(e.dataTransfer.files);
  };

  const toggleSelect = (id: string) => {
    const next = new Set<string>(selectedIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedIds());
    if (!confirm(`Xóa ${ids.length} ảnh?`)) return;
    await LibraryService.deleteImages(props.pageId, ids);
    setSelectedIds(new Set<string>());
    await loadImages(searchQuery());
    await loadStats();
  };

  const handleImageClick = (img: LibraryImage) => {
    if (props.mode === 'pick') {
      toggleSelect(img.id);
    } else {
      toggleSelect(img.id);
    }
  };

  const content = () => (
    <div style={{
      background: 'var(--color-bg-primary)',
      'border-radius': props.embedded ? '0' : '16px',
      width: props.embedded ? '100%' : '860px',
      height: props.embedded ? '100%' : '80vh',
      display: 'flex',
      'flex-direction': 'column',
      overflow: 'hidden',
      'box-shadow': props.embedded ? 'none' : '0 8px 40px rgba(0,0,0,0.2)',
    }}>
      {/* HEADER */}
      <div style={{
        padding: '16px 20px 12px',
        'border-bottom': '1px solid var(--color-border)',
        display: 'flex',
        'align-items': 'center',
        gap: '12px',
        'flex-shrink': '0',
      }}>
        <h2 style={{ 'font-size': '16px', 'font-weight': '600', flex: '1', margin: '0', display: 'flex', 'align-items': 'center', gap: '8px' }}>
          <IconFolder size={20} /> Thư viện ảnh
        </h2>

        {/* Search */}
        <div style={{ position: 'relative', width: '240px' }}>
          <span style={{
            position: 'absolute', left: '10px', top: '50%',
            transform: 'translateY(-50%)', display: 'flex', 'align-items': 'center',
          }}><IconSearch size={14} /></span>
          <input
            placeholder="Tìm tên ảnh..."
            value={searchQuery()}
            onInput={(e) => handleSearch(e.currentTarget.value)}
            style={{
              width: '100%', height: '34px',
              border: '1px solid var(--color-border)',
              'border-radius': '17px',
              padding: '0 14px 0 32px',
              'font-size': '13px', outline: 'none',
              background: 'var(--color-bg-secondary)',
              'box-sizing': 'border-box',
            }}
          />
        </div>

        <span style={{ 'font-size': '12px', color: 'var(--color-text-secondary)', 'white-space': 'nowrap' }}>
          {stats().count} ảnh · {stats().totalSizeMB} MB
        </span>

        <Show when={!props.embedded}>
          <button
            type="button"
            onClick={props.onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              'font-size': '18px', color: 'var(--color-text-secondary)',
              width: '30px', height: '30px', 'border-radius': '50%',
              display: 'flex', 'align-items': 'center', 'justify-content': 'center',
            }}
          ><IconClose size={14} /></button>
        </Show>
      </div>

      {/* TOOLBAR */}
      <div style={{
        padding: '10px 20px',
        display: 'flex', 'align-items': 'center', gap: '8px',
        'border-bottom': '1px solid var(--color-border)',
        background: 'var(--color-bg-secondary)',
        'flex-shrink': '0',
      }}>
        <label style={{
          display: 'flex', 'align-items': 'center', gap: '6px',
          padding: '7px 14px',
          background: 'var(--color-primary)', color: 'white',
          'border-radius': '8px', cursor: uploading() ? 'not-allowed' : 'pointer',
          'font-size': '13px', 'font-weight': '500',
          opacity: uploading() ? '0.7' : '1',
        }}>
          {uploading() ? `Đang tải... ${uploadProgress()}%` : '+ Thêm ảnh'}
          <input
            type="file" accept="image/*" multiple
            style={{ display: 'none' }}
            disabled={uploading()}
            onChange={(e) => e.target.files && handleUpload(e.target.files)}
          />
        </label>

        <Show when={selectedIds().size > 0}>
          <Show when={props.mode === 'manage'}>
            <button
              type="button"
              onClick={handleDeleteSelected}
              style={{
                display: 'flex', 'align-items': 'center', gap: '6px',
                padding: '7px 14px',
                background: '#ffebee', color: '#e53935',
                border: '1px solid #ffcdd2', 'border-radius': '8px',
                cursor: 'pointer', 'font-size': '13px',
              }}
            >🗑️ Xóa {selectedIds().size}</button>
          </Show>

          <button
            type="button"
            onClick={() => setSelectedIds(new Set<string>())}
            style={{
              padding: '7px 12px', background: 'none',
              border: '1px solid var(--color-border)',
              'border-radius': '8px', cursor: 'pointer', 'font-size': '12px',
            }}
          >Bỏ chọn</button>
        </Show>

        <div style={{ flex: '1' }} />
        <span style={{ 'font-size': '12px', color: 'var(--color-text-secondary)' }}>
          {total()} kết quả
        </span>
      </div>

      {/* GRID */}
      <div
        style={{
          flex: '1', 'overflow-y': 'auto', padding: '16px 20px',
          background: dragOver() ? 'rgba(51,144,236,0.05)' : 'transparent',
          transition: 'background 200ms',
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <Show when={loading()}>
          <div style={{
            display: 'flex', 'align-items': 'center', 'justify-content': 'center',
            height: '160px', color: 'var(--color-text-secondary)',
          }}>Đang tải...</div>
        </Show>

        <Show when={!loading() && images().length === 0}>
          <div style={{
            display: 'flex', 'flex-direction': 'column', 'align-items': 'center',
            'justify-content': 'center', height: '240px', gap: '12px',
            color: 'var(--color-text-secondary)',
          }}>
            <span style={{ opacity: '0.3', display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}><IconImage size={40} /></span>
            <p style={{ 'font-size': '15px', margin: '0' }}>
              {searchQuery() ? 'Không tìm thấy ảnh' : 'Chưa có ảnh nào'}
            </p>
            <p style={{ 'font-size': '13px', margin: '0' }}>
              Kéo thả ảnh vào đây hoặc nhấn "+ Thêm ảnh"
            </p>
          </div>
        </Show>

        <div style={{
          display: 'grid',
          'grid-template-columns': 'repeat(5, 1fr)',
          gap: '10px',
        }}>
          <For each={images()}>
            {(img) => {
              const isSelected = () => selectedIds().has(img.id);
              return (
                <div
                  onClick={() => handleImageClick(img)}
                  style={{
                    position: 'relative', 'border-radius': '8px',
                    overflow: 'hidden', cursor: 'pointer',
                    'aspect-ratio': '1',
                    border: isSelected()
                      ? '2px solid var(--color-primary)'
                      : '2px solid transparent',
                    transition: 'border 150ms, transform 150ms',
                    background: 'var(--color-bg-secondary)',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.03)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                >
                  <img
                    src={img.url} alt={img.originalName} loading="lazy"
                    style={{ width: '100%', height: '100%', 'object-fit': 'cover', display: 'block' }}
                  />

                  <Show when={isSelected()}>
                    <div style={{
                      position: 'absolute', inset: '0',
                      background: 'rgba(51,144,236,0.2)',
                      display: 'flex', 'align-items': 'flex-start',
                      'justify-content': 'flex-end', padding: '5px',
                    }}>
                      <div style={{
                        width: '20px', height: '20px',
                        background: 'var(--color-primary)', 'border-radius': '50%',
                        display: 'flex', 'align-items': 'center',
                        'justify-content': 'center', color: 'white', 'font-size': '12px',
                      }}><IconCheck size={12} /></div>
                    </div>
                  </Show>

                  <div style={{
                    position: 'absolute', bottom: '0', left: '0', right: '0',
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
                    padding: '14px 5px 5px',
                    color: 'white', 'font-size': '10px',
                    overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap',
                  }}>{img.originalName}</div>
                </div>
              );
            }}
          </For>
        </div>

        <Show when={images().length < total()}>
          <div style={{ 'text-align': 'center', 'margin-top': '14px' }}>
            <button
              type="button"
              onClick={() => loadImages(searchQuery(), images().length, true)}
              style={{
                padding: '9px 22px', border: '1px solid var(--color-border)',
                'border-radius': '8px', background: 'none', cursor: 'pointer', 'font-size': '13px',
              }}
            >Tải thêm ({total() - images().length} ảnh)</button>
          </div>
        </Show>
      </div>

      {/* FOOTER — mode pick: chọn nhiều, nút Confirm */}
      <Show when={props.mode === 'pick'}>
        <div style={{
          padding: '12px 20px',
          'border-top': '1px solid var(--color-border)',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'space-between',
          background: '#ffffff',
          'flex-shrink': '0',
        }}>
          <span style={{ 'font-size': '14px', color: '#707579' }}>
            <Show when={selectedIds().size > 0} fallback="Chọn ảnh để gửi">
              Đã chọn {selectedIds().size} ảnh
            </Show>
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={props.onClose}
              style={{
                padding: '8px 18px',
                border: '1px solid var(--color-border)',
                'border-radius': '8px',
                background: 'none',
                cursor: 'pointer',
                'font-size': '14px',
              }}
            >Hủy</button>
            <button
              type="button"
              onClick={() => {
                const selected = images().filter((img) => selectedIds().has(img.id));
                if (selected.length === 0) return;
                props.onSelectMultiple?.(selected);
                props.onClose();
              }}
              disabled={selectedIds().size === 0}
              style={{
                padding: '8px 20px',
                background: selectedIds().size > 0 ? '#3390ec' : '#e0e0e0',
                color: selectedIds().size > 0 ? 'white' : '#707579',
                border: 'none',
                'border-radius': '8px',
                cursor: selectedIds().size > 0 ? 'pointer' : 'default',
                'font-size': '14px',
                'font-weight': '500',
              }}
            >
              Chọn ({selectedIds().size})
            </button>
          </div>
        </div>
      </Show>
    </div>
  );

  if (props.embedded) {
    return content();
  }

  return (
    <div style={{
      position: 'fixed', inset: '0',
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', 'align-items': 'center', 'justify-content': 'center',
      'z-index': '1000',
    }}>
      {content()}
    </div>
  );
};
