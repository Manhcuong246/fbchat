import { onMount, onCleanup, For, Show, createSignal, createMemo, createEffect } from 'solid-js';
import { produce } from 'solid-js/store';
import { IconSettings, IconLogout, IconWarning, IconSearch } from '../shared/Icons';
import { useNavigate } from '@solidjs/router';
import { ConversationItem } from './ConversationItem';
import { convState, setConvState } from '../../stores/conversationStore';
import { setMsgState } from '../../stores/messageStore';
import type { ConversationData } from '../../types/conversation';
import { authState, logout } from '../../stores/authStore';
import { fetchConversations, fetchMoreConversations, clearAllCache, getCachedConversations } from '../../services/syncService';
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
  const [confirmClearDb, setConfirmClearDb] = createSignal(false);

  const filteredConversations = createMemo(() => {
    const q = searchQuery().toLowerCase().trim();
    if (!q) return convState.conversations;
    return convState.conversations.filter((c) =>
      c.participant.name.toLowerCase().includes(q)
    );
  });

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

  const handleClearDb = async () => {
    if (!confirmClearDb()) {
      setConfirmClearDb(true);
      return;
    }
    setConfirmClearDb(false);
    setShowMenu(false);
    try {
      const res = await fetch('http://localhost:3001/db/clear', { method: 'DELETE' });
      if (!res.ok) throw new Error('Xóa thất bại');
      clearConversationsLightCache();
      setConvState({ conversations: [], selectedId: null, selectedPageId: null });
      setMsgState({ messages: {}, beforeCursors: {}, refreshTrigger: {}, loading: false, loadingMore: false, lastLoadTime: {} });
      setConvState('loading', true);
      await clearAllCache();
      await fetchConversations();
    } catch (e) {
      console.error('[CLEAR DB]', e);
    } finally {
      setConvState('loading', false);
    }
  };

  const handleConvListScroll = () => {
    const el = listEl;
    if (!el || convState.loadingMore) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const threshold = 150;
    if (scrollTop + clientHeight < scrollHeight - threshold) return;
    if (convState.hasMore['merged'] === true && convState.afterCursors['merged']) {
      fetchMoreConversations();
    }
  };

  createEffect(() => {
    if (showMenu()) document.body.classList.add('menu-open-sidebar');
    else document.body.classList.remove('menu-open-sidebar');
    onCleanup(() => document.body.classList.remove('menu-open-sidebar'));
  });

  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const menu = document.getElementById('sidebar-menu-root');
      if (menu && !menu.contains(e.target as Node)) {
        setShowMenu(false);
        setConfirmLogout(false);
        setConfirmClearDb(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    onCleanup(() => document.removeEventListener('click', handleClickOutside));

    const pages = authState.selectedPages;
    if (pages.length > 0) {
      const cached = getCachedConversations();
      if (cached?.length) {
        setConvState(
          produce((s) => {
            s.conversations = cached;
            s.loading = false;
          })
        );
      } else {
        setConvState('loading', true);
      }
      setConvState('error', null);
      fetchConversations()
        .then(() => setConvState('error', null))
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
        <div id="sidebar-menu-root" style={{ position: 'relative', 'flex-shrink': 0, 'z-index': 100 }}>
          <button
            type="button"
            aria-label="Menu"
            onClick={(e) => { e.stopPropagation(); setShowMenu((v) => !v); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '12px',
              'min-width': '44px', 'min-height': '44px',
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
              'min-width': '200px', 'z-index': '99999', overflow: 'visible',
              animation: 'slideDown 180ms ease forwards',
            }}>
              <button
                type="button"
                onClick={() => {
                  setShowMenu(false);
                  const first = authState.selectedPages[0];
                  if (first) navigate(`/settings/${first.id}`);
                }}
                style={{
                  display: 'flex', 'align-items': 'center', gap: '12px', width: '100%',
                  padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
                  'font-size': '14px', color: '#000000', 'text-align': 'left',
                  transition: 'background 150ms', 'box-sizing': 'border-box',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f3f4'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
              >
                <span style={{ width: '24px', display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}><IconSettings size={18} /></span>
                Setting page
              </button>
              <div style={{ height: '1px', background: '#f0f0f0', margin: '4px 0' }} />
              <button
                type="button"
                onClick={async () => {
                  setShowMenu(false);
                  setConvState('loading', true);
                  await clearAllCache();
                  clearConversationsLightCache();
                  setConvState({ conversations: [], selectedId: null, selectedPageId: null });
                  try {
                    await fetchConversations();
                  } finally {
                    setConvState('loading', false);
                  }
                }}
                style={{
                  display: 'flex', 'align-items': 'center', gap: '12px', width: '100%',
                  padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
                  'font-size': '14px', color: '#3390ec', 'text-align': 'left',
                  transition: 'background 150ms', 'box-sizing': 'border-box',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f3f4'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
              >
                <span style={{ width: '24px', display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}><IconSettings size={18} /></span>
                Xóa cache và tải lại
              </button>
              <button
                type="button"
                onClick={handleClearDb}
                style={{
                  display: 'flex', 'align-items': 'center', gap: '12px', width: '100%',
                  padding: '12px 16px', background: confirmClearDb() ? '#fff3f3' : 'none', border: 'none', cursor: 'pointer',
                  'font-size': '14px', color: '#e53935', 'font-weight': confirmClearDb() ? '600' : '400', 'text-align': 'left',
                  transition: 'background 150ms', 'box-sizing': 'border-box',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = confirmClearDb() ? '#ffe8e8' : '#f1f3f4'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = confirmClearDb() ? '#fff3f3' : 'none'; }}
              >
                <span style={{ width: '24px', display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}><IconWarning size={18} /></span>
                {confirmClearDb() ? 'Xác nhận xóa toàn bộ?' : 'Xóa toàn bộ dữ liệu'}
              </button>
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
            <For each={Array(8).fill(0)}>
              {() => (
                <div style={{ display: 'flex', gap: '12px', padding: '12px 16px', 'align-items': 'center' }}>
                  <div style={{ width: '44px', height: '44px', 'border-radius': '50%', background: '#e5e7eb', 'flex-shrink': 0 }} />
                  <div style={{ flex: 1, display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
                    <div style={{ width: '60%', height: '14px', 'border-radius': '7px', background: '#e5e7eb' }} />
                    <div style={{ width: '80%', height: '12px', 'border-radius': '6px', background: '#f3f4f6' }} />
                  </div>
                </div>
              )}
            </For>
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
                  data={conv}
                  index={i()}
                  isSelected={convState.selectedId === conv.id}
                  onClick={() => handleSelectConversation(conv)}
                />
              )}
            </For>
            <Show when={convState.loadingMore}>
              <div style={{ padding: '16px', display: 'flex', 'justify-content': 'center', 'flex-shrink': 0 }}>
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
