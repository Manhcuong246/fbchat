import { createSignal, onMount, Show } from 'solid-js';
import { IconSettings, IconLightning, IconFolder } from '../shared/Icons';
import { useParams, useNavigate } from '@solidjs/router';
import { SettingsService, type PageSettings } from '../../services/settingsService';
import { QuickReplyService, type QuickReply } from '../../services/quickReplyService';
import { QuickRepliesTab } from './QuickRepliesTab';
import { ImageLibrary } from '../library/ImageLibrary';
import { authState } from '../../stores/authStore';

type Tab = 'general' | 'quick_replies' | 'library';

export default function SettingsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const pageId = () => params.pageId;
  const page = () => authState.selectedPages.find((p) => p.id === pageId());

  const [activeTab, setActiveTab] = createSignal<Tab>('general');
  const [settings, setSettings] = createSignal<PageSettings | null>(null);
  const [quickReplies, setQuickReplies] = createSignal<QuickReply[]>([]);
  const [saving, setSaving] = createSignal(false);
  const [saved, setSaved] = createSignal(false);

  onMount(async () => {
    const pid = pageId();
    if (!pid) return;
    const [s, qr] = await Promise.all([
      SettingsService.get(pid),
      QuickReplyService.getAll(pid),
    ]);
    setSettings(s);
    setQuickReplies(qr);
  });

  const handleSaveSettings = async () => {
    if (!settings() || !pageId()) return;
    setSaving(true);
    await SettingsService.save(pageId()!, settings()!);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDeleteReply = async (replyId: string) => {
    if (!confirm('Xóa tin nhắn nhanh này?')) return;
    const pid = pageId();
    if (!pid) return;
    await QuickReplyService.delete(pid, replyId);
    setQuickReplies((prev) => prev.filter((r) => r.id !== replyId));
  };

  const tabs: { key: Tab; icon: 'settings' | 'lightning' | 'folder'; label: string }[] = [
    { key: 'general', icon: 'settings', label: 'Tổng quan' },
    { key: 'quick_replies', icon: 'lightning', label: 'Tin nhắn nhanh' },
    { key: 'library', icon: 'folder', label: 'Thư viện ảnh' },
  ];

  return (
    <Show when={pageId()} fallback={<div style={{ padding: '20px' }}>Trang không hợp lệ.</div>}>
    <div style={{ height: '100%', display: 'flex', 'flex-direction': 'column', background: '#f5f5f5' }}>
      {/* HEADER */}
      <div style={{ height: '56px', 'flex-shrink': '0', background: '#ffffff', 'border-bottom': '1px solid #e0e0e0', display: 'flex', 'align-items': 'center', padding: '0 20px', gap: '12px', 'box-shadow': '0 1px 3px rgba(0,0,0,0.06)' }}>
        <button
          onClick={() => navigate('/')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', 'border-radius': '50%', width: '36px', height: '36px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: '#707579' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f3f4')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
        </button>
        <div style={{ width: '32px', height: '32px', 'border-radius': '50%', background: page()?.color || '#3390ec', display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: 'white', 'font-weight': '700', 'font-size': '13px', 'flex-shrink': '0' }}>
          {page()?.name?.[0]?.toUpperCase()}
        </div>
        <div style={{ 'font-size': '15px', 'font-weight': '600' }}>Cài đặt — {page()?.name}</div>
      </div>

      {/* BODY */}
      <div style={{ flex: '1', display: 'flex', 'min-height': '0', 'max-width': '960px', margin: '0 auto', width: '100%', padding: '20px', gap: '20px', 'overflow': 'hidden' }}>
        {/* Sidebar tabs */}
        <div style={{ width: '190px', 'flex-shrink': '0', display: 'flex', 'flex-direction': 'column', gap: '2px' }}>
          {tabs.map((tab) => (
            <button
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'flex', 'align-items': 'center', gap: '10px',
                padding: '10px 14px', 'border-radius': '10px', border: 'none',
                cursor: 'pointer', 'text-align': 'left', 'font-size': '14px',
                'font-family': 'inherit',
                background: activeTab() === tab.key ? '#3390ec' : 'none',
                color: activeTab() === tab.key ? 'white' : '#000',
                'font-weight': activeTab() === tab.key ? '500' : '400',
                transition: 'background 150ms',
              }}
              onMouseEnter={(e) => { if (activeTab() !== tab.key) e.currentTarget.style.background = '#f1f3f4'; }}
              onMouseLeave={(e) => { if (activeTab() !== tab.key) e.currentTarget.style.background = 'none'; }}
            >
              <span style={{ display: 'flex', 'align-items': 'center' }}>{tab.icon === 'settings' ? <IconSettings size={18} /> : tab.icon === 'lightning' ? <IconLightning size={18} /> : <IconFolder size={18} />}</span>{tab.label}
            </button>
          ))}
        </div>

        {/* Content panel */}
        <div style={{ flex: '1', background: '#ffffff', 'border-radius': '12px', 'box-shadow': '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden', display: 'flex', 'flex-direction': 'column' }}>

          {/* TAB: GENERAL */}
          <Show when={activeTab() === 'general' && settings()}>
            <div style={{ padding: '24px', 'overflow-y': 'auto', flex: '1' }}>
              <h2 style={{ 'font-size': '17px', 'font-weight': '600', 'margin-bottom': '24px' }}>Cài đặt tổng quan</h2>

              {/* Send mode */}
              <div style={{ 'margin-bottom': '24px' }}>
                <label style={{ display: 'block', 'font-size': '12px', 'font-weight': '600', color: '#707579', 'margin-bottom': '10px', 'text-transform': 'uppercase', 'letter-spacing': '0.5px' }}>
                  Chế độ gửi tin nhắn
                </label>
                {([
                  { value: 'single', title: 'Gửi 1 tin nhắn', desc: 'Giữ nguyên xuống dòng, gửi thành 1 bong bóng' },
                  { value: 'split', title: 'Tách thành nhiều tin', desc: 'Mỗi đoạn văn (cách nhau dòng trống) = 1 tin riêng' },
                ] as const).map((opt) => (
                  <label style={{
                    display: 'flex', gap: '12px', padding: '14px', 'border-radius': '10px',
                    border: settings()?.sendMode === opt.value ? '1.5px solid #3390ec' : '1.5px solid #e0e0e0',
                    cursor: 'pointer', 'margin-bottom': '8px',
                    background: settings()?.sendMode === opt.value ? '#e8f4fd' : 'white',
                    transition: 'all 150ms',
                  }}>
                    <input type="radio" name="sendMode" value={opt.value} checked={settings()?.sendMode === opt.value} onChange={() => setSettings((s) => ({ ...s!, sendMode: opt.value }))} style={{ 'margin-top': '2px' }} />
                    <div>
                      <div style={{ 'font-size': '14px', 'font-weight': '500' }}>{opt.title}</div>
                      <div style={{ 'font-size': '13px', color: '#707579', 'margin-top': '2px' }}>{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Signature */}
              <div style={{ 'margin-bottom': '24px' }}>
                <label style={{ display: 'block', 'font-size': '12px', 'font-weight': '600', color: '#707579', 'margin-bottom': '8px', 'text-transform': 'uppercase', 'letter-spacing': '0.5px' }}>
                  Chữ ký (tự động thêm vào cuối tin)
                </label>
                <textarea
                  value={settings()?.signature || ''}
                  onInput={(e) => setSettings((s) => ({ ...s!, signature: e.currentTarget.value }))}
                  placeholder="Ví dụ: Tarot Quán Mộc - Chữa Lành 🌿"
                  rows={2}
                  style={{ width: '100%', border: '1.5px solid #e0e0e0', 'border-radius': '10px', padding: '12px', 'font-size': '14px', resize: 'vertical', outline: 'none', 'font-family': 'inherit', 'box-sizing': 'border-box', transition: 'border 150ms' }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#3390ec')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#e0e0e0')}
                />
              </div>

              <button
                onClick={handleSaveSettings}
                disabled={saving()}
                style={{ padding: '12px 28px', background: saved() ? '#43a047' : '#3390ec', color: 'white', border: 'none', 'border-radius': '10px', cursor: 'pointer', 'font-size': '14px', 'font-weight': '600', transition: 'background 200ms', 'font-family': 'inherit' }}
              >
                {saving() ? 'Đang lưu...' : saved() ? 'Đã lưu' : 'Lưu cài đặt'}
              </button>
            </div>
          </Show>

          {/* TAB: QUICK REPLIES */}
          <Show when={activeTab() === 'quick_replies'}>
            <QuickRepliesTab
              pageId={pageId()!}
              replies={quickReplies()}
              onUpdate={setQuickReplies}
              onDelete={handleDeleteReply}
            />
          </Show>

          {/* TAB: LIBRARY */}
          <Show when={activeTab() === 'library'}>
            <div style={{ flex: '1', overflow: 'hidden' }}>
              <ImageLibrary pageId={pageId()!} mode="manage" onClose={() => {}} onSelect={() => {}} embedded={true} />
            </div>
          </Show>
        </div>
      </div>
    </div>
    </Show>
  );
}
