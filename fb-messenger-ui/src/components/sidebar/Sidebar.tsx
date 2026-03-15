import { onMount, onCleanup, For, Show, createSignal, createMemo } from 'solid-js';
import { IconSettings, IconLogout, IconWarning, IconSearch } from '../shared/Icons';
import { useNavigate } from '@solidjs/router';
import { ConversationItem } from './ConversationItem';
import { convState, setConvState } from '../../stores/conversationStore';
import { msgState } from '../../stores/messageStore';
import type { ConversationData } from '../../types/conversation';
import { authState, logout } from '../../stores/authStore';
import { fetchConversations, fetchMoreConversations } from '../../services/syncService';
import { clearConversationsLightCache } from '../../services/fbConversationService';
import { ReadTracker } from '../../services/readTracker';

const PERMISSION_ERROR_MSG =
  'Token thiếu quyền pages_messaging. Vui lòng tạo lại token với đủ permissions.';

export const Sidebar = () => {
  const navigate = useNavigate();
  let listEl: HTMLDivElement | undefined;
  const [searchQuery, setSearchQuery] = createSignal('');
  const [showMenu, setShowMenu] = createSignal(false);
  const [confirmLogout, setConfirmLogout] = createSignal(false);
  const [showSettingsSubmenu, setShowSettingsSubmenu] = createSignal(false);

  const filteredConversations = createMemo(() => {
    const q = searchQuery().toLowerCase().trim();
    if (!q) return convState.conversations;
    return convState.conversations.filter((c) =>
      c.participant.name.toLowerCase().includes(q)
    );
  });

  /** Preview đồng bộ với khung tin nhắn: ưu tiên lấy từ msgState.messages nếu đã load. */
  /** Cập nhật participant.name từ senderName trong tin nhắn khi API trả "Khách"/Unknown. */
  const displayConv = (conv: ConversationData): ConversationData => {
    const msgs = msgState.messages[conv.id];
    if (msgs?.length) {
      const last = msgs[msgs.length - 1];
      const hasMedia = !!last.media || !!(last.medias?.length);
      const text = last.text ?? (hasMedia ? 'Tệp đính kèm' : '');
      const isPlaceholderName = !conv.participant.name || conv.participant.name === 'Khách';
      const fromParticipant = msgs.filter((m) => !m.isFromPage);
      const senderName = fromParticipant.length > 0
        ? fromParticipant[fromParticipant.length - 1].senderName
        : '';
      const participantName = isPlaceholderName && senderName
        ? senderName
        : conv.participant.name;
      return {
        ...conv,
        lastMessage: text,
        lastMessageTime: last.timestamp,
        participant: { ...conv.participant, name: participantName },
      };
    }
    return conv;
  };

  const handleSelectConversation = (conv: ConversationData) => {
    setConvState('selectedId', conv.id);
    setConvState('selectedPageId', conv.pageId);
    ReadTracker.markRead(conv.id, conv.latestMessageId);
    setConvState(
      'conversations',
      (list: typeof convState.conversations) =>
        list.map((c) => (c.id === conv.id ? { ...c, unreadCount: 0 } : c))
    );
  };

  const handleLogout = () => {
    if (!confirmLogout()) {
      setConfirmLogout(true);
      return;
    }
    setConfirmLogout(false);
    clearConversationsLightCache();
    setConvState({ conversations: [], selectedId: null, selectedPageId: null, error: null });
    logout();
  };

  const handleConvListScroll = () => {
    const el = listEl;
    if (!el || convState.loadingMore) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const threshold = 80;
    if (scrollTop + clientHeight < scrollHeight - threshold) return;
    authState.selectedPages.forEach((p) => {
      if (convState.hasMore[p.id] && convState.afterCursors[p.id]) {
        fetchMoreConversations(p.id);
      }
    });
  };

  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const menu = document.getElementById('sidebar-menu-root');
      if (menu && !menu.contains(e.target as Node)) {
        setShowMenu(false);
        setShowSettingsSubmenu(false);
        setConfirmLogout(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    onCleanup(() => document.removeEventListener('click', handleClickOutside));

    const pages = authState.selectedPages;
    if (pages.length > 0) {
      setConvState('loading', true);
      setConvState('error', null);
      Promise.all(pages.map((p) => fetchConversations(p.id)))
        .then(() => {
          setConvState('loading', false);
          setConvState('error', null);
        })
        .catch((err: unknown) => {
          setConvState('loading', false);
          const msg = err instanceof Error ? err.message : String(err);
          const isPermissionError =
            msg.toLowerCase().includes('permission') || msg.includes('298') || msg.includes('403');
          setConvState('error', isPermissionError ? PERMISSION_ERROR_MSG : msg);
        });
    } else {
      setConvState('loading', false);
    }
  });

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', height: '100%', overflow: 'hidden' }}>
      <header class="sidebar-topbar">
        <div id="sidebar-menu-root" style={{ position: 'relative', 'flex-shrink': 0 }}>
          <button
            type="button"
            aria-label="Menu"
            onClick={(e) => { e.stopPropagation(); setShowMenu((v) => !v); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '8px',
              'border-radius': '50%', display: 'flex', 'align-items': 'center',
              'justify-content': 'center', color: '#707579', transition: 'background 150ms, color 150ms',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f3f4'; e.currentTarget.style.color = '#3390ec'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#707579'; }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <rect x="2" y="4" width="16" height="2" rx="1" />
              <rect x="2" y="9" width="16" height="2" rx="1" />
              <rect x="2" y="14" width="16" height="2" rx="1" />
            </svg>
          </button>

          <Show when={showMenu()}>
            <div style={{
              position: 'absolute', top: '44px', left: '0', background: '#ffffff',
              'border-radius': '12px', 'box-shadow': '0 4px 24px rgba(0,0,0,0.15)',
              'min-width': '200px', 'z-index': '200', overflow: 'visible',
              animation: 'slideDown 180ms ease forwards',
            }}>
              <button
                type="button"
                onClick={() => setShowSettingsSubmenu((v) => !v)}
                style={{
                  display: 'flex', 'align-items': 'center', gap: '12px', width: '100%',
                  padding: '12px 16px', background: showSettingsSubmenu() ? '#f1f3f4' : 'none',
                  border: 'none', cursor: 'pointer', 'font-size': '14px', color: '#000000',
                  'text-align': 'left', transition: 'background 150ms', 'box-sizing': 'border-box',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f3f4'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = showSettingsSubmenu() ? '#f1f3f4' : 'none'; }}
              >
                <span style={{ width: '24px', display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}><IconSettings size={18} /></span>
                Setting page
                <span style={{ 'margin-left': 'auto', 'font-size': '12px', transform: showSettingsSubmenu() ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}>▶</span>
              </button>
              <Show when={showSettingsSubmenu() && authState.selectedPages.length > 0}>
                <div style={{ padding: '0 0 8px 0', 'border-bottom': '1px solid #f0f0f0', 'margin-bottom': '4px' }}>
                  <For each={authState.selectedPages}>
                    {(page) => (
                      <button
                        type="button"
                        onClick={() => { setShowMenu(false); setShowSettingsSubmenu(false); navigate(`/settings/${page.id}`); }}
                        style={{
                          display: 'flex', 'align-items': 'center', gap: '10px', width: '100%',
                          padding: '8px 16px 8px 48px', background: 'none', border: 'none', cursor: 'pointer',
                          'font-size': '14px', color: '#000000', 'text-align': 'left',
                          transition: 'background 150ms', 'box-sizing': 'border-box',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f3f4'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                      >
                        <div style={{ width: '28px', height: '28px', 'border-radius': '50%', background: page.color || '#3390ec', display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: 'white', 'font-size': '11px', 'font-weight': '700', 'flex-shrink': '0' }}>{page.name[0]?.toUpperCase()}</div>
                        <span style={{ overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                          {page.name}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              <div style={{ height: '1px', background: '#f0f0f0', margin: '4px 0' }} />
              <button type="button" onClick={handleLogout} style={{ display: 'flex', 'align-items': 'center', gap: '12px', width: '100%', padding: '12px 16px', background: confirmLogout() ? '#fff3f3' : 'none', border: 'none', cursor: 'pointer', 'font-size': '14px', color: '#e53935', 'font-weight': confirmLogout() ? '600' : '400', 'text-align': 'left', transition: 'background 150ms', 'box-sizing': 'border-box' }} onMouseEnter={(e) => { e.currentTarget.style.background = confirmLogout() ? '#ffe8e8' : '#f1f3f4'; }} onMouseLeave={(e) => { e.currentTarget.style.background = confirmLogout() ? '#fff3f3' : 'none'; }}>
                <span style={{ width: '24px', display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}>{confirmLogout() ? <IconWarning size={18} /> : <IconLogout size={18} />}</span>
                {confirmLogout() ? 'Xác nhận đăng xuất?' : 'Đăng xuất'}
              </button>
            </div>
          </Show>
        </div>

        <div class="search-wrapper">
          <span class="search-icon" aria-hidden><IconSearch size={16} /></span>
          <input class="search-input" type="text" placeholder="Tìm kiếm" value={searchQuery()} onInput={(e) => setSearchQuery(e.currentTarget.value)} />
        </div>
      </header>

      <div class="conv-list" ref={(el) => (listEl = el)} onScroll={handleConvListScroll}>
        <Show
          when={!convState.loading}
          fallback={
            <div style={{
              display: 'flex',
              'flex-direction': 'column',
              'align-items': 'center',
              'justify-content': 'center',
              padding: '24px 16px',
              gap: '16px',
              'min-height': 'min(300px, 50vh)',
            }}>
              <div style={{
                width: '32px',
                height: '32px',
                border: '3px solid #e8e8e8',
                'border-top-color': '#3390ec',
                'border-radius': '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <span style={{ 'font-size': '14px', color: '#707579' }}>Đang tải danh sách...</span>
            </div>
          }
        >
        {convState.error ? (
          <div
            style={{
              padding: 'var(--space-md)',
              display: 'flex',
              'flex-direction': 'column',
              gap: 'var(--space-md)',
            }}
          >
            <p
              style={{
                margin: 0,
                'font-size': 'var(--font-size-sm)',
                color: 'var(--color-danger)',
                'line-height': 1.4,
              }}
            >
              {convState.error}
            </p>
            <button
              type="button"
              onClick={handleLogout}
              style={{
                padding: '10px 16px',
                'font-size': 'var(--font-size-sm)',
                'font-weight': 'var(--font-weight-medium)',
                color: '#fff',
                background: 'var(--color-primary)',
                border: 'none',
                'border-radius': 'var(--bubble-radius-small)',
                cursor: 'pointer',
                'align-self': 'flex-start',
              }}
            >
              Đăng xuất
            </button>
          </div>
        ) : (
          <>
            <For each={filteredConversations()}>
              {(conv, i) => (
                <ConversationItem
                  data={displayConv(conv)}
                  index={i()}
                  isSelected={convState.selectedId === conv.id}
                  onClick={() => handleSelectConversation(conv)}
                />
              )}
            </For>
            <Show when={convState.loadingMore}>
              <div style={{ padding: '12px', display: 'flex', 'justify-content': 'center' }}>
                <div style={{
                  width: '24px', height: '24px',
                  border: '2px solid #e8e8e8', 'border-top-color': '#3390ec',
                  'border-radius': '50%', animation: 'spin 0.8s linear infinite',
                }} />
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </Show>
          </>
        )}
        </Show>
      </div>
    </div>
  );
};
