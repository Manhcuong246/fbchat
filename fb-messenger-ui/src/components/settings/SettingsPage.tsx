import { createSignal, Show, createEffect, For, onMount, onCleanup } from 'solid-js';
import { IconSettings, IconLightning, IconFolder } from '../shared/Icons';
import { Avatar } from '../shared/Avatar';
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
  const [showPageDropdown, setShowPageDropdown] = createSignal(false);

  const loadPageData = async (pid: string) => {
    const [s, qr] = await Promise.all([
      SettingsService.get(pid),
      QuickReplyService.getAll(pid),
    ]);
    setSettings(s);
    setQuickReplies(qr);
  };

  createEffect(() => {
    const pid = pageId();
    if (pid) loadPageData(pid);
  });

  onMount(() => {
    const closeDropdown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-page-dropdown]')) setShowPageDropdown(false);
    };
    document.addEventListener('click', closeDropdown);
    onCleanup(() => document.removeEventListener('click', closeDropdown));
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
    <div class="settings-page">
      {/* HEADER */}
      <header class="settings-header">
        <button type="button" class="settings-header-back" onClick={() => navigate('/')} aria-label="Quay lại">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
        </button>
        <Avatar name={page()?.name ?? ''} size={32} avatarUrl={page()?.avatarUrl} />
        <div data-page-dropdown style={{ position: 'relative', flexShrink: 0, minWidth: 0, flex: 1 }}>
          <button
            type="button"
            class="settings-header-title"
            onClick={() => setShowPageDropdown((v) => !v)}
          >
            Cài đặt — {page()?.name}
            <span style={{ fontSize: '12px', transform: showPageDropdown() ? 'rotate(180deg)' : 'none', transition: 'transform 150ms', flexShrink: 0 }}>▼</span>
          </button>
          <Show when={showPageDropdown() && authState.selectedPages.length >= 1}>
            <div
              style={{
                position: 'absolute', top: '100%', left: 0, 'margin-top': '4px',
                background: '#ffffff', 'border-radius': '10px', 'box-shadow': '0 4px 16px rgba(0,0,0,0.12)',
                'min-width': '200px', 'z-index': 1000, overflow: 'hidden',
              }}
            >
              <For each={authState.selectedPages}>
                {(p) => (
                  <button
                    type="button"
                    onClick={() => {
                      setShowPageDropdown(false);
                      navigate(`/settings/${p.id}`);
                    }}
                    style={{
                      display: 'flex', 'align-items': 'center', gap: '10px', width: '100%',
                      padding: '10px 14px', background: p.id === pageId() ? '#e8f4fd' : 'none',
                      border: 'none', cursor: 'pointer', 'font-size': '14px', color: '#000',
                      'text-align': 'left', transition: 'background 150ms',
                    }}
                    onMouseEnter={(e) => { if (p.id !== pageId()) e.currentTarget.style.background = '#f1f3f4'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = p.id === pageId() ? '#e8f4fd' : 'none'; }}
                  >
                    <Avatar name={p.name} size={24} avatarUrl={p.avatarUrl} />
                    <span style={{ overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>{p.name}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </header>

      {/* BODY */}
      <div class="settings-body">
        {/* Sidebar tabs */}
        <nav class="settings-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab() === tab.key}
              classList={{ 'settings-tab-btn': true, active: activeTab() === tab.key }}
              onClick={() => setActiveTab(tab.key)}
            >
              <span style={{ display: 'flex', alignItems: 'center' }}>{tab.icon === 'settings' ? <IconSettings size={18} /> : tab.icon === 'lightning' ? <IconLightning size={18} /> : <IconFolder size={18} />}</span>
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Content panel */}
        <div class="settings-content" role="tabpanel">

          {/* TAB: GENERAL */}
          <Show when={activeTab() === 'general' && settings()}>
            <div class="settings-general">
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
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <QuickRepliesTab
              pageId={pageId()!}
              replies={quickReplies()}
              onUpdate={setQuickReplies}
              onDelete={handleDeleteReply}
            />
            </div>
          </Show>

          {/* TAB: LIBRARY */}
          <Show when={activeTab() === 'library'}>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <ImageLibrary pageId={pageId()!} mode="manage" onClose={() => {}} onSelect={() => {}} embedded={true} />
            </div>
          </Show>
        </div>
      </div>
    </div>
    </Show>
  );
}
