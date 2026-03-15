import { createSignal, For, Show } from 'solid-js';
import { IconLightning, IconImage, IconClose } from '../shared/Icons';
import { QuickReplyService, type QuickReply, type QuickReplyBlock } from '../../services/quickReplyService';

interface Props {
  pageId: string;
  replies: QuickReply[];
  onUpdate: (replies: QuickReply[]) => void;
  onDelete: (id: string) => void;
}

const btn = (extra: Record<string, string> = {}) => ({
  border: 'none', cursor: 'pointer', 'font-family': 'inherit', ...extra,
});

export const QuickRepliesTab = (props: Props) => {
  const [showForm, setShowForm] = createSignal(false);
  const [editing, setEditing] = createSignal<QuickReply | null>(null);
  const [shortcut, setShortcut] = createSignal('');
  const [blocks, setBlocks] = createSignal<QuickReplyBlock[]>([{ id: '1', type: 'text', text: '' }]);
  const [saving, setSaving] = createSignal(false);

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

  const handleImageBlock = (blockId: string, e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => updateBlock(blockId, { imageFile: ev.target?.result as string, imageName: file.name });
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    const sc = shortcut().replace('/', '').trim();
    if (!sc) return alert('Nhập ký tự tắt');
    const validBlocks = blocks().filter(
      (b) => (b.type === 'text' && b.text?.trim()) || (b.type === 'image' && b.imageFile)
    );
    if (validBlocks.length === 0) return alert('Thêm ít nhất 1 nội dung');
    setSaving(true);
    const reply: QuickReply = {
      id: editing()?.id || QuickReplyService.generateId(),
      shortcut: sc,
      blocks: validBlocks,
    };
    const ok = await QuickReplyService.save(props.pageId, reply);
    setSaving(false);
    if (ok) {
      const updated = await QuickReplyService.getAll(props.pageId);
      props.onUpdate(updated);
      setShowForm(false);
    }
  };

  return (
    <div style={{ flex: '1', display: 'flex', 'flex-direction': 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 16px', 'border-bottom': '1px solid #f0f0f0', display: 'flex', 'align-items': 'center', 'justify-content': 'space-between' }}>
        <div>
          <h2 style={{ 'font-size': '17px', 'font-weight': '600', display: 'flex', 'align-items': 'center', gap: '8px' }}><IconLightning size={20} /> Tin nhắn nhanh</h2>
          <p style={{ 'font-size': '13px', color: '#707579', 'margin-top': '2px' }}>Gõ / trong ô chat để dùng</p>
        </div>
        <button onClick={openAdd} style={{ ...btn(), padding: '8px 18px', background: '#3390ec', color: 'white', 'border-radius': '8px', 'font-size': '14px', 'font-weight': '500' }}>
          + Thêm mới
        </button>
      </div>

      {/* List */}
      <div style={{ flex: '1', 'overflow-y': 'auto', padding: '16px 24px' }}>
        <Show when={props.replies.length === 0}>
          <div style={{ 'text-align': 'center', padding: '48px', color: '#707579' }}>
            <div style={{ 'margin-bottom': '12px', opacity: '0.4', display: 'flex', 'justify-content': 'center' }}><IconLightning size={40} /></div>
            <p>Chưa có tin nhắn nhanh nào</p>
          </div>
        </Show>
        <For each={props.replies}>
          {(reply) => (
            <div
              style={{ display: 'flex', 'align-items': 'flex-start', gap: '12px', padding: '14px', 'border-radius': '10px', 'margin-bottom': '8px', border: '1px solid #f0f0f0', background: '#fafafa', transition: 'border 150ms' }}
              onMouseEnter={(e) => (e.currentTarget.style.border = '1px solid #d0d0d0')}
              onMouseLeave={(e) => (e.currentTarget.style.border = '1px solid #f0f0f0')}
            >
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

      {/* Form Modal */}
      <Show when={showForm()}>
        <div style={{ position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.4)', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'z-index': '9999' }}>
          <div style={{ background: 'white', 'border-radius': '14px', width: '500px', 'max-height': '80vh', display: 'flex', 'flex-direction': 'column', 'box-shadow': '0 8px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ padding: '20px 24px 16px', 'border-bottom': '1px solid #f0f0f0', display: 'flex', 'align-items': 'center', 'justify-content': 'space-between' }}>
              <h3 style={{ 'font-size': '16px', 'font-weight': '600' }}>{editing() ? 'Sửa tin nhắn nhanh' : 'Thêm tin nhắn nhanh'}</h3>
              <button onClick={() => setShowForm(false)} style={{ ...btn(), background: 'none', color: '#707579', display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}><IconClose size={18} /></button>
            </div>

            <div style={{ padding: '20px 24px', 'overflow-y': 'auto', flex: '1' }}>
              {/* Shortcut */}
              <div style={{ 'margin-bottom': '16px' }}>
                <label style={{ display: 'block', 'font-size': '12px', 'font-weight': '500', color: '#707579', 'margin-bottom': '6px', 'text-transform': 'uppercase' }}>Ký tự tắt</label>
                <div style={{ display: 'flex' }}>
                  <span style={{ padding: '10px 12px', background: '#f5f5f5', border: '1.5px solid #e0e0e0', 'border-right': 'none', 'border-radius': '8px 0 0 8px', color: '#3390ec', 'font-weight': '700' }}>/</span>
                  <input
                    value={shortcut()}
                    onInput={(e) => setShortcut(e.currentTarget.value.replace('/', ''))}
                    placeholder="vd: chao, stk, gia..."
                    style={{ flex: '1', border: '1.5px solid #e0e0e0', 'border-radius': '0 8px 8px 0', padding: '10px 12px', 'font-size': '14px', outline: 'none', 'font-family': 'inherit' }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = '#3390ec')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = '#e0e0e0')}
                  />
                </div>
              </div>

              {/* Blocks */}
              <label style={{ display: 'block', 'font-size': '12px', 'font-weight': '500', color: '#707579', 'margin-bottom': '8px', 'text-transform': 'uppercase' }}>Nội dung</label>
              <For each={blocks()}>
                {(block, i) => (
                  <div style={{ border: '1.5px solid #e0e0e0', 'border-radius': '10px', padding: '12px', 'margin-bottom': '8px' }}>
                    <div style={{ display: 'flex', 'align-items': 'center', 'margin-bottom': '8px' }}>
                      <span style={{ 'font-size': '12px', color: '#707579', flex: '1' }}>Tin {i() + 1}</span>
                      <Show when={blocks().length > 1}>
                        <button onClick={() => removeBlock(block.id)} style={{ ...btn(), background: 'none', color: '#e53935', display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}><IconClose size={14} /></button>
                      </Show>
                    </div>
                    <Show when={block.type === 'text'}>
                      <textarea
                        value={block.text || ''}
                        onInput={(e) => updateBlock(block.id, { text: e.currentTarget.value })}
                        placeholder="Nội dung tin nhắn..."
                        rows={2}
                        style={{ width: '100%', border: '1px solid #e0e0e0', 'border-radius': '8px', padding: '8px 12px', 'font-size': '14px', resize: 'vertical', outline: 'none', 'font-family': 'inherit', 'box-sizing': 'border-box' }}
                      />
                    </Show>
                    <Show when={block.type === 'image'}>
                      <Show
                        when={block.imageFile}
                        fallback={
                          <label style={{ display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: '6px', padding: '20px', border: '2px dashed #e0e0e0', 'border-radius': '8px', cursor: 'pointer' }}>
                            <span style={{ display: 'flex', 'align-items': 'center' }}><IconImage size={28} /></span>
                            <span style={{ 'font-size': '13px', color: '#707579' }}>Chọn ảnh</span>
                            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleImageBlock(block.id, e)} />
                          </label>
                        }
                      >
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                          <img src={block.imageFile} style={{ height: '80px', 'border-radius': '6px' }} alt="" />
                          <button onClick={() => updateBlock(block.id, { imageFile: undefined })} style={{ position: 'absolute', top: '-6px', right: '-6px', background: '#e53935', color: 'white', border: 'none', 'border-radius': '50%', width: '20px', height: '20px', cursor: 'pointer', display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}><IconClose size={10} /></button>
                        </div>
                      </Show>
                    </Show>
                  </div>
                )}
              </For>
              <div style={{ display: 'flex', gap: '8px', 'margin-top': '4px' }}>
                {(['text', 'image'] as const).map((type) => (
                  <button
                    onClick={() => addBlock(type)}
                    style={{ ...btn(), flex: '1', padding: '9px', border: '1.5px dashed #d0d0d0', 'border-radius': '8px', background: 'none', 'font-size': '13px', color: '#707579', transition: 'border-color 150ms, color 150ms' }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3390ec'; e.currentTarget.style.color = '#3390ec'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#d0d0d0'; e.currentTarget.style.color = '#707579'; }}
                  >
                    + {type === 'text' ? 'Text' : 'Ảnh'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ padding: '16px 24px', 'border-top': '1px solid #f0f0f0', display: 'flex', gap: '8px', 'justify-content': 'flex-end' }}>
              <button onClick={() => setShowForm(false)} style={{ ...btn(), padding: '10px 20px', border: '1.5px solid #e0e0e0', 'border-radius': '8px', background: 'none', 'font-size': '14px' }}>Hủy</button>
              <button onClick={handleSave} disabled={saving()} style={{ ...btn(), padding: '10px 24px', background: '#3390ec', color: 'white', 'border-radius': '8px', 'font-size': '14px', 'font-weight': '600' }}>
                {saving() ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
