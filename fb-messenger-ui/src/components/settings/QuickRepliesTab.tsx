import { createSignal, For, Show } from 'solid-js';
import { IconLightning, IconImage, IconClose, IconCheck, IconType } from '../shared/Icons';
import { QuickReplyService, type QuickReply, type QuickReplyBlock } from '../../services/quickReplyService';
import { LibraryService } from '../../services/libraryService';

const MAX_TEXT_LENGTH = 2000;

interface Props {
  pageId: string;
  replies: QuickReply[];
  onUpdate: (replies: QuickReply[]) => void;
  onDelete: (id: string) => void;
}

type CopyStatus = 'idle' | 'copied';
type ImportStatus = 'idle' | 'loading' | 'success' | 'error';

const btn = (extra: Record<string, string> = {}) => ({
  border: 'none', cursor: 'pointer', 'font-family': 'inherit', ...extra,
});

export const QuickRepliesTab = (props: Props) => {
  const [showForm, setShowForm] = createSignal(false);
  const [editing, setEditing] = createSignal<QuickReply | null>(null);
  const [shortcut, setShortcut] = createSignal('');
  const [blocks, setBlocks] = createSignal<QuickReplyBlock[]>([{ id: '1', type: 'text', text: '' }]);
  const [saving, setSaving] = createSignal(false);
  const [copyStatus, setCopyStatus] = createSignal<CopyStatus>('idle');
  const [importMode, setImportMode] = createSignal<'merge' | 'replace'>('merge');
  const [importStatus, setImportStatus] = createSignal<ImportStatus>('idle');
  const [showCopyFallback, setShowCopyFallback] = createSignal(false);
  const [copyFallbackJson, setCopyFallbackJson] = createSignal('');
  const [showPasteFallback, setShowPasteFallback] = createSignal(false);
  const [pasteFallbackText, setPasteFallbackText] = createSignal('');

  const openAdd = () => {
    setEditing(null);
    setShortcut('');
    setBlocks([{ id: Date.now().toString(), type: 'text', text: '' }]);
    setShowForm(true);
  };

  const openEdit = (reply: QuickReply) => {
    setEditing(reply);
    setShortcut(reply.shortcut);
    setBlocks(reply.blocks.map((b) => ({ ...b })));
    setShowForm(true);
  };

  const addBlock = (type: 'text' | 'image') =>
    setBlocks((prev) => [...prev, { id: Date.now().toString(), type, text: '' }]);

  const removeBlock = (id: string) => setBlocks((prev) => prev.filter((b) => b.id !== id));

  const updateBlock = (id: string, changes: Partial<QuickReplyBlock>) =>
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...changes } : b)));

  const [draggingBlockIds, setDraggingBlockIds] = createSignal<Record<string, boolean>>({});

  const setBlockDragging = (blockId: string, value: boolean) =>
    setDraggingBlockIds((prev) => ({ ...prev, [blockId]: value }));

  const handleImageFile = async (blockId: string, file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('Ảnh tối đa 5MB');
      return;
    }
    try {
      const uploaded = await LibraryService.uploadImages(props.pageId, [file]);
      if (uploaded.length > 0) {
        updateBlock(blockId, { imageUrl: uploaded[0].url, imageName: file.name, imageFile: undefined });
      } else {
        alert('Upload ảnh thất bại. Thử lại.');
      }
    } catch (e) {
      console.error('[QuickReply] Upload image:', e);
      alert('Upload ảnh thất bại. Kiểm tra kết nối.');
    }
  };

  const handleImageBlock = (blockId: string, e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) handleImageFile(blockId, file);
  };

  const handleSave = async () => {
    const sc = shortcut().replace('/', '').trim();
    if (!sc) return alert('Nhập ký tự tắt');
    const validBlocks = blocks().filter(
      (b) => (b.type === 'text' && b.text?.trim()) || (b.type === 'image' && (b.imageUrl || b.imageFile))
    );
    if (validBlocks.length === 0) return alert('Thêm ít nhất 1 nội dung');
    setSaving(true);
    try {
      const reply: QuickReply = {
        id: editing()?.id || QuickReplyService.generateId(),
        shortcut: sc,
        blocks: validBlocks,
      };
      const result = await QuickReplyService.save(props.pageId, reply);
      if (result.ok) {
        const updated = await QuickReplyService.getAll(props.pageId);
        props.onUpdate(updated);
        setShowForm(false);
      } else {
        alert(result.error || 'Lưu thất bại. Thử lại.');
      }
    } catch (e) {
      alert('Lưu thất bại. Kiểm tra kết nối hoặc thử ảnh nhỏ hơn.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    let json = '';
    try {
      const data = await QuickReplyService.export(props.pageId);
      json = JSON.stringify(data, null, 2);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
        setCopyStatus('copied');
        setTimeout(() => setCopyStatus('idle'), 2000);
        return;
      }
    } catch {
      json = JSON.stringify({ source_page_id: props.pageId, exported_at: Date.now(), replies: props.replies }, null, 2);
    }
    setCopyFallbackJson(json);
    setShowCopyFallback(true);
  };

  const doImport = async (replies: unknown[], sourcePageId?: string) => {
    if (!Array.isArray(replies)) {
      alert('Dữ liệu không hợp lệ. Hãy sao chép từ trang tin nhắn nhanh của page khác.');
      return;
    }
    const valid = replies.filter((r): r is QuickReply => r != null && typeof r === 'object' && 'shortcut' in r && Array.isArray((r as QuickReply).blocks));
    const toImport = valid.length > 0 ? valid : (replies as QuickReply[]);
    if (toImport.length === 0) {
      alert('Dữ liệu không hợp lệ. Hãy sao chép từ trang tin nhắn nhanh của page khác.');
      return;
    }

    if (importMode() === 'replace') {
      const ok = confirm(`Xóa toàn bộ tin nhắn nhanh hiện tại và thay bằng ${toImport.length} tin nhắn từ page "${sourcePageId ?? 'khác'}"?`);
      if (!ok) return;
    }

    setImportStatus('loading');
    try {
      const result = await QuickReplyService.import(props.pageId, toImport, importMode());
      if (result.ok) {
        const updated = await QuickReplyService.getAll(props.pageId);
        props.onUpdate(updated);
        setImportStatus('success');
        setTimeout(() => setImportStatus('idle'), 2000);
      } else {
        setImportStatus('error');
        setTimeout(() => setImportStatus('idle'), 2000);
      }
    } catch {
      setImportStatus('error');
      setTimeout(() => setImportStatus('idle'), 2000);
    }
  };

  const handlePaste = async () => {
    const runImport = (text: string) => {
      try {
        const parsed = JSON.parse(text) as { replies?: unknown[]; source_page_id?: string };
        if (!Array.isArray(parsed.replies)) {
          alert('Dữ liệu không hợp lệ. Hãy sao chép từ trang tin nhắn nhanh của page khác.');
          return;
        }
        doImport(parsed.replies, parsed.source_page_id);
      } catch {
        alert('Dữ liệu không hợp lệ. Kiểm tra clipboard hoặc JSON.');
      }
    };

    if (showPasteFallback()) {
      runImport(pasteFallbackText());
      setShowPasteFallback(false);
      setPasteFallbackText('');
      return;
    }

    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        runImport(text);
      } else {
        setShowPasteFallback(true);
      }
    } catch {
      setShowPasteFallback(true);
    }
  };

  return (
    <div class="settings-qr-root" style={{ flex: '1 1 0', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div class="settings-qr-header">
        <div>
          <h2 style={{ 'font-size': '17px', 'font-weight': '600', display: 'flex', 'align-items': 'center', gap: '8px' }}><IconLightning size={20} /> Tin nhắn nhanh</h2>
          <p style={{ 'font-size': '13px', color: '#707579', 'margin-top': '2px' }}>Gõ / trong ô chat để dùng</p>
        </div>
        <button onClick={openAdd} style={{ ...btn(), padding: '8px 18px', background: '#3390ec', color: 'white', 'border-radius': '8px', 'font-size': '14px', 'font-weight': '500' }}>
          + Thêm mới
        </button>
      </div>

      {/* Copy / Paste toolbar */}
      <div class="settings-qr-toolbar">
        <button
          onClick={handleCopy}
          class="settings-qr-btn-copy"
          style={{ ...btn(), padding: '8px 14px', background: '#f5f5f5', border: '1px solid #e0e0e0', 'border-radius': '8px', 'font-size': '13px', display: 'flex', 'align-items': 'center', gap: '6px', whiteSpace: 'nowrap' }}
        >
          {copyStatus() === 'copied' ? (
            <>
              <IconCheck size={16} />
              Đã sao chép
            </>
          ) : (
            <>Sao chép {props.replies.length} tin nhắn nhanh</>
          )}
        </button>
        <select
          value={importMode()}
          onChange={(e) => setImportMode(e.currentTarget.value as 'merge' | 'replace')}
          class="settings-qr-select-import"
          title={importMode() === 'merge' ? 'Giữ cũ + thêm mới (bỏ qua trùng shortcut)' : 'Xóa hết và thay mới'}
          style={{ padding: '8px 12px', border: '1px solid #e0e0e0', 'border-radius': '8px', 'font-size': '13px', 'font-family': 'inherit', background: 'white', minWidth: '160px' }}
        >
          <option value="merge">Gộp (bỏ qua trùng)</option>
          <option value="replace">Thay mới hoàn toàn</option>
        </select>
        <button
          onClick={handlePaste}
          disabled={importStatus() === 'loading'}
          class="settings-qr-btn-paste"
          style={{
            ...btn(),
            padding: '8px 14px',
            background: importStatus() === 'loading' ? '#e0e0e0' : '#f5f5f5',
            border: '1px solid #e0e0e0',
            'border-radius': '8px',
            'font-size': '13px',
            display: 'flex',
            'align-items': 'center',
            gap: '6px',
            opacity: importStatus() === 'loading' ? 0.7 : 1,
            whiteSpace: 'nowrap',
          }}
        >
            {importStatus() === 'loading'
              ? 'Đang nhập...'
              : importStatus() === 'success'
                ? (<> <IconCheck size={16} /> Đã nhập </>)
                : importStatus() === 'error'
                  ? 'Lỗi — kiểm tra clipboard'
                  : 'Dán từ page khác'}
        </button>
      </div>

      {/* List */}
      <div class="settings-qr-list">
        <Show when={props.replies.length === 0}>
          <div style={{ 'text-align': 'center', padding: '48px', color: '#707579' }}>
            <div style={{ 'margin-bottom': '12px', opacity: '0.4', display: 'flex', 'justify-content': 'center' }}><IconLightning size={40} /></div>
            <p>Chưa có tin nhắn nhanh nào</p>
          </div>
        </Show>
        <For each={props.replies}>
          {(reply) => (
            <div class="settings-qr-item">
              <span style={{ background: '#e8f4fd', color: '#3390ec', padding: '4px 12px', 'border-radius': '6px', 'font-weight': '600', 'font-size': '13px', 'white-space': 'nowrap', 'flex-shrink': '0' }}>
                /{reply.shortcut}
              </span>
              <div style={{ flex: '1', 'min-width': '0' }}>
                <For each={reply.blocks.slice(0, 2)}>
                  {(block) => (
                    <div style={{ 'font-size': '13px', color: '#444', 'margin-bottom': '2px', display: 'flex', 'align-items': 'center', gap: '4px' }}>
                      {block.type === 'image' ? (
                        <><span style={{ display: 'inline-flex', 'align-items': 'center', 'margin-right': '6px' }}><IconImage size={16} /></span><span style={{ color: '#707579', 'font-style': 'italic' }}>{block.imageName || 'Hình ảnh'}</span></>
                      ) : (
                        <span style={{ overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>{block.text}</span>
                      )}
                    </div>
                  )}
                </For>
                <Show when={reply.blocks.length > 2}>
                  <span style={{ 'font-size': '12px', color: '#aaa' }}>+{reply.blocks.length - 2} phần nữa</span>
                </Show>
              </div>
              <div style={{ display: 'flex', gap: '4px', 'flex-shrink': '0' }}>
                <button onClick={() => openEdit(reply)} style={{ ...btn(), padding: '6px 14px', background: 'none', border: '1px solid #e0e0e0', 'border-radius': '6px', 'font-size': '13px' }}>Sửa</button>
                <button onClick={() => props.onDelete(reply.id)} style={{ ...btn(), padding: '6px 14px', background: 'none', border: '1px solid #ffcdd2', 'border-radius': '6px', 'font-size': '13px', color: '#e53935' }}>Xóa</button>
              </div>
            </div>
          )}
        </For>
      </div>

      {/* Copy fallback modal — when clipboard.writeText unavailable */}
      <Show when={showCopyFallback()}>
        <div class="settings-modal-overlay">
          <div class="settings-modal">
            <div style={{ padding: '16px 24px', 'border-bottom': '1px solid #f0f0f0', display: 'flex', 'align-items': 'center', 'justify-content': 'space-between' }}>
              <h3 style={{ 'font-size': '16px', 'font-weight': '600' }}>Sao chép thủ công</h3>
              <button onClick={() => setShowCopyFallback(false)} style={{ ...btn(), background: 'none', color: '#707579' }}><IconClose size={18} /></button>
            </div>
            <div style={{ padding: '16px 24px', flex: '1', overflow: 'auto' }}>
              <p style={{ 'font-size': '13px', color: '#707579', 'margin-bottom': '12px' }}>Clipboard không khả dụng. Chọn và sao chép toàn bộ nội dung bên dưới:</p>
              <textarea
                readOnly
                value={copyFallbackJson()}
                rows={12}
                style={{ width: '100%', border: '1px solid #e0e0e0', 'border-radius': '8px', padding: '12px', 'font-size': '12px', 'font-family': 'monospace', resize: 'vertical', outline: 'none', 'box-sizing': 'border-box' }}
              />
            </div>
          </div>
        </div>
      </Show>

      {/* Paste fallback modal — when clipboard.readText unavailable */}
      <Show when={showPasteFallback()}>
        <div class="settings-modal-overlay">
          <div class="settings-modal">
            <div style={{ padding: '16px 24px', 'border-bottom': '1px solid #f0f0f0', display: 'flex', 'align-items': 'center', 'justify-content': 'space-between' }}>
              <h3 style={{ 'font-size': '16px', 'font-weight': '600' }}>Dán từ JSON</h3>
              <button onClick={() => { setShowPasteFallback(false); setPasteFallbackText(''); }} style={{ ...btn(), background: 'none', color: '#707579' }}><IconClose size={18} /></button>
            </div>
            <div style={{ padding: '16px 24px', flex: '1', overflow: 'auto' }}>
              <p style={{ 'font-size': '13px', color: '#707579', 'margin-bottom': '12px' }}>Dán JSON đã sao chép từ trang tin nhắn nhanh của page khác:</p>
              <textarea
                value={pasteFallbackText()}
                onInput={(e) => setPasteFallbackText(e.currentTarget.value)}
                placeholder='{"source_page_id":"...","replies":[...]}'
                rows={10}
                style={{ width: '100%', border: '1px solid #e0e0e0', 'border-radius': '8px', padding: '12px', 'font-size': '12px', 'font-family': 'monospace', resize: 'vertical', outline: 'none', 'box-sizing': 'border-box' }}
              />
            </div>
            <div style={{ padding: '16px 24px', 'border-top': '1px solid #f0f0f0', display: 'flex', gap: '8px', 'justify-content': 'flex-end' }}>
              <button onClick={() => { setShowPasteFallback(false); setPasteFallbackText(''); }} style={{ ...btn(), padding: '10px 20px', border: '1.5px solid #e0e0e0', 'border-radius': '8px', background: 'none' }}>Hủy</button>
              <button onClick={handlePaste} style={{ ...btn(), padding: '10px 24px', background: '#3390ec', color: 'white', 'border-radius': '8px', 'font-weight': '600' }}>Nhập</button>
            </div>
          </div>
        </div>
      </Show>

      {/* Form Modal — Add/Edit quick reply */}
      <Show when={showForm()}>
        <div class="settings-modal-overlay">
          <div class="settings-modal">
            {/* Header: title + shortcut side by side */}
            <div style={{ display: 'flex', 'align-items': 'center', gap: '12px', padding: '20px 24px 16px', 'border-bottom': '1px solid #f0f0f0' }}>
              <div style={{ flex: '1', display: 'flex', 'align-items': 'center', 'justify-content': 'space-between' }}>
                <h2 style={{ margin: 0, 'font-size': '18px', 'font-weight': 600, color: '#111827' }}>
                  Tin nhắn nhanh
                </h2>
                <button onClick={() => setShowForm(false)} style={{ ...btn(), background: 'none', color: '#707579', padding: '4px', display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}><IconClose size={20} /></button>
              </div>
              <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', background: '#f3f4f6', 'border-radius': '10px', padding: '6px 12px' }}>
                <span style={{ color: '#9ca3af', 'font-size': '16px', 'font-weight': 600 }}>/</span>
                <input
                  placeholder="shortcut"
                  value={shortcut()}
                  onInput={(e) => setShortcut(e.currentTarget.value.replace(/[/\s]/g, ''))}
                  style={{ border: 'none', background: 'transparent', outline: 'none', 'font-size': '14px', width: '100px', color: '#374151', 'font-family': 'inherit' }}
                />
              </div>
            </div>

            {/* Blocks section — scrollable */}
            <div style={{ padding: '16px 24px', flex: '1', 'min-height': 0, overflow: 'hidden', display: 'flex', 'flex-direction': 'column' }}>
              <label style={{ display: 'block', 'font-size': '12px', 'font-weight': 600, color: '#6b7280', 'margin-bottom': '12px', 'text-transform': 'uppercase', 'letter-spacing': '0.5px' }}>
                Nội dung
              </label>
              <div style={{ flex: '1', 'min-height': 0, overflow: 'auto', 'margin-bottom': '12px' }}>
                <For each={blocks()}>
                  {(block) => (
                    <div style={{ 'margin-bottom': '12px' }}>
                      {block.type === 'text' ? (
                        <div style={{ border: '1px solid #e5e7eb', 'border-radius': '12px', padding: '12px', background: '#fafafa', position: 'relative' }}>
                          <div style={{ display: 'flex', 'justify-content': 'space-between', 'margin-bottom': '8px' }}>
                            <span style={{ 'font-size': '11px', 'font-weight': 600, color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', 'border-radius': '99px', 'text-transform': 'uppercase', 'letter-spacing': '0.5px', display: 'inline-flex', 'align-items': 'center', gap: '4px' }}>
                              <IconType size={12} /> Văn bản
                            </span>
                            <Show when={blocks().length > 1}>
                              <button type="button" onClick={() => removeBlock(block.id)} style={{ ...btn(), color: '#ef4444', background: 'none', 'font-size': '18px', 'line-height': 1, padding: '0 4px' }}>×</button>
                            </Show>
                          </div>
                          <textarea
                            value={block.text || ''}
                            onInput={(e) => {
                              const v = e.currentTarget.value.slice(0, MAX_TEXT_LENGTH);
                              updateBlock(block.id, { text: v });
                            }}
                            placeholder="Nhập nội dung tin nhắn..."
                            style={{ width: '100%', border: 'none', background: 'transparent', resize: 'vertical', 'min-height': '80px', 'font-size': '14px', outline: 'none', 'line-height': 1.6, 'box-sizing': 'border-box', 'font-family': 'inherit' }}
                          />
                          <div style={{ 'text-align': 'right', 'font-size': '11px', color: '#9ca3af' }}>
                            {(block.text ?? '').length}/{MAX_TEXT_LENGTH}
                          </div>
                        </div>
                      ) : (
                        <div style={{ border: '1px solid #e5e7eb', 'border-radius': '12px', padding: '12px', background: '#fafafa', position: 'relative' }}>
                          <div style={{ display: 'flex', 'justify-content': 'space-between', 'margin-bottom': '8px' }}>
                            <span style={{ 'font-size': '11px', 'font-weight': 600, color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', 'border-radius': '99px', 'text-transform': 'uppercase', 'letter-spacing': '0.5px', display: 'inline-flex', 'align-items': 'center', gap: '4px' }}>
                              <IconImage size={12} /> Hình ảnh
                            </span>
                            <Show when={blocks().length > 1}>
                              <button type="button" onClick={() => removeBlock(block.id)} style={{ ...btn(), color: '#ef4444', background: 'none', 'font-size': '18px', 'line-height': 1, padding: '0 4px' }}>×</button>
                            </Show>
                          </div>
                          <Show
                            when={block.imageUrl || block.imageFile}
                            fallback={
                              <div
                                role="button"
                                tabIndex={0}
                                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setBlockDragging(block.id, true); }}
                                onDragLeave={() => setBlockDragging(block.id, false)}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  setBlockDragging(block.id, false);
                                  const file = e.dataTransfer?.files?.[0];
                                  if (file?.type.startsWith('image/')) handleImageFile(block.id, file);
                                }}
                                onClick={() => (document.getElementById(`qr-file-${block.id}`) as HTMLInputElement)?.click()}
                                style={{
                                  border: `2px dashed ${draggingBlockIds()[block.id] ? '#6366f1' : '#d1d5db'}`,
                                  'border-radius': '12px',
                                  padding: '32px 16px',
                                  'text-align': 'center',
                                  cursor: 'pointer',
                                  background: draggingBlockIds()[block.id] ? '#eef2ff' : '#fafafa',
                                  transition: 'all 0.2s',
                                }}
                              >
                                <div style={{ display: 'flex', 'justify-content': 'center', 'margin-bottom': '8px', color: '#9ca3af' }}><IconImage size={32} /></div>
                                <div style={{ 'font-size': '13px', color: '#6b7280', 'font-weight': 500 }}>Kéo thả ảnh vào đây</div>
                                <div style={{ 'font-size': '12px', color: '#9ca3af', 'margin-top': '4px' }}>
                                  hoặc <span style={{ color: '#6366f1', 'text-decoration': 'underline' }}>chọn từ máy tính</span>
                                </div>
                                <div style={{ 'font-size': '11px', color: '#d1d5db', 'margin-top': '8px' }}>JPG, PNG, GIF · tối đa 5MB</div>
                                <input id={`qr-file-${block.id}`} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleImageBlock(block.id, e)} />
                              </div>
                            }
                          >
                            <div style={{ position: 'relative', 'border-radius': '12px', overflow: 'hidden' }}>
                              <img src={block.imageUrl || block.imageFile} style={{ width: '100%', 'max-height': '200px', 'object-fit': 'cover', display: 'block', 'border-radius': '10px' }} alt="" />
                              <div
                                style={{
                                  position: 'absolute', inset: '0',
                                  background: 'rgba(0,0,0,0.45)',
                                  display: 'flex', 'align-items': 'center', 'justify-content': 'center',
                                  gap: '12px',
                                  'border-radius': '10px',
                                  transition: 'opacity 0.2s',
                                  opacity: 0,
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; }}
                              >
                                <button type="button" onClick={(ev) => { ev.stopPropagation(); (document.getElementById(`qr-file-${block.id}`) as HTMLInputElement)?.click(); }} style={{ ...btn(), background: 'white', 'border-radius': '8px', padding: '6px 14px', 'font-size': '13px', 'font-weight': 500 }}>
                                  Thay ảnh
                                </button>
                                <button type="button" onClick={(ev) => { ev.stopPropagation(); updateBlock(block.id, { imageFile: undefined, imageUrl: undefined, imageName: undefined }); }} style={{ ...btn(), background: '#ef4444', color: 'white', 'border-radius': '8px', padding: '6px 14px', 'font-size': '13px', 'font-weight': 500 }}>
                                  Xóa
                                </button>
                              </div>
                              <input id={`qr-file-${block.id}`} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleImageBlock(block.id, e)} />
                            </div>
                          </Show>
                        </div>
                      )}
                    </div>
                  )}
                </For>
              </div>

              {/* Add block buttons */}
              <div style={{ display: 'flex', gap: '8px', 'flex-shrink': 0 }}>
                <button
                  type="button"
                  onClick={() => addBlock('text')}
                  style={{ ...btn(), flex: 1, padding: '10px', 'border-radius': '10px', border: '1.5px dashed #d1d5db', background: 'white', 'font-size': '13px', color: '#374151', display: 'flex', 'align-items': 'center', 'justify-content': 'center', gap: '6px', transition: 'border-color 0.2s, background 0.2s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.background = '#fafafe'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.background = 'white'; }}
                >
                  <IconType size={18} /> Thêm văn bản
                </button>
                <button
                  type="button"
                  onClick={() => addBlock('image')}
                  style={{ ...btn(), flex: 1, padding: '10px', 'border-radius': '10px', border: '1.5px dashed #d1d5db', background: 'white', 'font-size': '13px', color: '#374151', display: 'flex', 'align-items': 'center', 'justify-content': 'center', gap: '6px', transition: 'border-color 0.2s, background 0.2s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.background = '#fafafe'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.background = 'white'; }}
                >
                  <IconImage size={18} /> Thêm hình ảnh
                </button>
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '16px 24px', 'border-top': '1px solid #f0f0f0', display: 'flex', gap: '8px', 'justify-content': 'flex-end' }}>
              <button type="button" onClick={() => setShowForm(false)} style={{ ...btn(), padding: '10px 20px', border: '1.5px solid #e0e0e0', 'border-radius': '10px', background: 'none', 'font-size': '14px', color: '#374151' }}>Hủy</button>
              <button type="button" onClick={handleSave} disabled={saving()} style={{ ...btn(), padding: '10px 24px', background: '#6366f1', color: 'white', 'border-radius': '10px', 'font-size': '14px', 'font-weight': 600 }}>
                {saving() ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
