import { Show, onMount, createEffect, onCleanup, lazy } from 'solid-js';
import { Router, Route } from '@solidjs/router';
import { LoginPage } from './components/auth/LoginPage';
import { RateLimitBanner } from './components/shared/RateLimitBanner';
import { authState, initAuth } from './stores/authStore';
import { setMsgState } from './stores/messageStore';
import { setConvState } from './stores/conversationStore';
import { startSync, stopSync } from './services/syncService';
import './scss/main.scss';

const MainApp = lazy(() => import('./components/layout/MainApp'));
const SettingsPage = lazy(() => import('./components/settings/SettingsPage'));

export default function App() {
  onMount(() => {
    setMsgState({
      messages: {},
      beforeCursors: {},
      refreshTrigger: {},
      loading: false,
      loadingMore: false,
    });
    setConvState({
      conversations: [],
      selectedId: null,
      selectedPageId: null,
      loading: true,
      loadingMore: false,
      afterCursors: {},
      hasMore: {},
      error: null,
    });
    initAuth();
  });

  createEffect(() => {
    if (authState.step === 'ready' && authState.selectedPages.length > 0) {
      startSync();
    }
  });

  onCleanup(() => stopSync());

  return (
    <Show when={authState.step === 'ready'} fallback={<LoginPage />}>
      <div style={{ display: 'flex', 'flex-direction': 'column', height: '100vh', overflow: 'hidden' }}>
        <RateLimitBanner />
        <div style={{ flex: 1, 'min-height': 0 }}>
          <Router>
            <Route path="/" component={MainApp} />
            <Route path="/settings/:pageId" component={SettingsPage} />
          </Router>
        </div>
      </div>
    </Show>
  );
}
