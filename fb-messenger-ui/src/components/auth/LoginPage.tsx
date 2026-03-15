import { createSignal, Show, For } from 'solid-js';
import { IconWarning, IconClose, IconPlus, IconSearch, IconFilter, IconCheck, IconSquareStack, IconLayoutGrid } from '../shared/Icons';
import { authState, setAuthState, submitUserToken, confirmSelectedPages } from '../../stores/authStore';

const InputStep = () => {
  const [token, setToken] = createSignal('');

  const handleSubmit = () => {
    const val = token().trim();
    if (!val) return;
    submitUserToken(val);
  };

  return (
    <div>
      <label style={{ display: 'block', 'font-size': '14px', 'font-weight': '500', color: '#374151', 'margin-bottom': '10px' }}>
        User Access Token
      </label>

      <textarea
        value={token()}
        onInput={(e) => setToken(e.currentTarget.value.trim())}
        placeholder="Dán User Access Token vào đây..."
        rows={3}
        disabled={authState.loading}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
        style={{
          width: '100%', 'box-sizing': 'border-box',
          border: '1px solid #e5e7eb', 'border-radius': '12px',
          padding: '14px 16px', 'font-size': '14px', resize: 'none', outline: 'none',
          'font-family': 'monospace', color: '#1a1a2e', 'margin-bottom': '12px',
          transition: 'border 200ms, box-shadow 200ms', background: '#fafafa',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = '#1877f2'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(24,119,242,0.15)'; e.currentTarget.style.background = '#fff'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.background = '#fafafa'; }}
      />

      <p style={{ 'font-size': '13px', color: '#6b7280', 'margin-bottom': '20px', 'line-height': '1.6' }}>
        Lấy token tại{' '}
        <a href="https://developers.facebook.com/tools/explorer" target="_blank" style={{ color: '#1877f2', 'text-decoration': 'none', 'font-weight': '500' }}>
          Graph API Explorer
        </a>
        {' '}→ <strong>User Token</strong> (không phải Page Token) → chọn quyền{' '}
        <code style={{ background: '#f3f4f6', padding: '2px 6px', 'border-radius': '6px', 'font-size': '12px', color: '#374151' }}>pages_show_list</code>
        , <code style={{ background: '#f3f4f6', padding: '2px 6px', 'border-radius': '6px', 'font-size': '12px', color: '#374151' }}>pages_messaging</code>
      </p>

      <Show when={authState.error}>
        <div style={{ background: '#fef2f2', color: '#dc2626', padding: '12px 16px', 'border-radius': '12px', 'font-size': '14px', 'margin-bottom': '20px', display: 'flex', 'align-items': 'center', gap: '10px', border: '1px solid #fecaca' }}>
          <IconWarning size={18} />
          <span>{authState.error}</span>
        </div>
      </Show>

      <button
        onClick={handleSubmit}
        disabled={!token() || authState.loading}
        style={{
          width: '100%', padding: '14px',
          background: token() && !authState.loading ? 'linear-gradient(135deg, #1877f2 0%, #0d5bbf 100%)' : '#e5e7eb',
          color: token() && !authState.loading ? 'white' : '#9ca3af',
          border: 'none', 'border-radius': '12px',
          'font-size': '15px', 'font-weight': '600',
          cursor: token() && !authState.loading ? 'pointer' : 'default',
          transition: 'all 200ms', 'box-shadow': token() && !authState.loading ? '0 4px 14px rgba(24,119,242,0.35)' : 'none',
          display: 'flex', 'align-items': 'center', 'justify-content': 'center', gap: '8px',
        }}
      >
        {authState.loading ? (
          <>
            <span style={{ display: 'inline-block', width: '18px', height: '18px', border: '2px solid rgba(255,255,255,0.4)', 'border-top-color': 'white', 'border-radius': '50%', animation: 'spin 0.7s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            Đang kiểm tra...
          </>
        ) : 'Tiếp tục'}
      </button>
    </div>
  );
};

const SelectPagesStep = () => {
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = createSignal('');

  const togglePage = (pageId: string) => {
    const s = new Set(selectedIds());
    if (s.has(pageId)) s.delete(pageId);
    else s.add(pageId);
    setSelectedIds(s);
  };

  const toggleSelectAll = () => {
    const all = authState.availablePages.map((p) => p.id);
    const current = selectedIds();
    const allSelected = all.every((id) => current.has(id));
    setSelectedIds(allSelected ? new Set<string>() : new Set<string>(all));
  };

  const filteredPages = () => {
    const q = searchQuery().trim().toLowerCase();
    if (!q) return authState.availablePages;
    return authState.availablePages.filter((p) => p.name.toLowerCase().includes(q));
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
      toggleSelectAll();
    }
  };

  const handleConfirm = () => {
    const selected = authState.availablePages.filter((p) => selectedIds().has(p.id));
    confirmSelectedPages(selected);
  };

  const goBack = () => setAuthState({ step: 'input_token', error: undefined });

  return (
    <div
      style={{ display: 'flex', 'flex-direction': 'column', height: '100%', 'min-height': '0', outline: 'none' }}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Select all + Search + actions — bỏ "Chế độ gộp trang" và "Mặc định" */}
      <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', gap: '20px', 'margin-bottom': '18px', 'flex-wrap': 'wrap' }}>
        <label style={{ display: 'flex', 'align-items': 'center', gap: '10px', cursor: 'pointer', 'font-size': '14px', color: '#374151', 'font-weight': '500', 'flex-shrink': 0 }}>
          <input
            type="checkbox"
            checked={authState.availablePages.length > 0 && authState.availablePages.every((p) => selectedIds().has(p.id))}
            onChange={toggleSelectAll}
            style={{ width: '18px', height: '18px', 'accent-color': '#1877f2' }}
          />
          Chọn tất cả các trang
        </label>
        <div class="login-search-input" style={{ display: 'flex', 'align-items': 'center', width: '100%', 'max-width': '320px', border: '1px solid #e5e7eb', 'border-radius': '10px', padding: '10px 14px', background: '#fff', 'box-shadow': '0 1px 2px rgba(0,0,0,0.04)', transition: 'border-color 200ms, box-shadow 200ms' }}>
          <span style={{ display: 'flex', 'align-items': 'center', color: '#9ca3af', 'margin-right': '10px' }}><IconSearch size={16} /></span>
          <input
            type="text"
            placeholder="Tìm kiếm trang"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            style={{ flex: 1, border: 'none', background: 'none', outline: 'none', 'font-size': '14px', color: '#1a1a2e', 'min-width': 0 }}
          />
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', color: '#9ca3af' }} aria-label="Lọc"><IconFilter size={16} /></button>
        </div>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'flex-shrink': 0 }}>
          <button onClick={() => {}} style={{ width: '40px', height: '40px', 'border-radius': '10px', background: '#f3f4f6', border: 'none', cursor: 'pointer', display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: '#4b5563', transition: 'background 200ms' }} aria-label="Thêm">
            <IconPlus size={18} />
          </button>
          <button onClick={goBack} style={{ width: '40px', height: '40px', 'border-radius': '10px', background: '#f3f4f6', border: 'none', cursor: 'pointer', display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: '#4b5563', transition: 'background 200ms' }} aria-label="Đóng">
            <IconClose size={18} />
          </button>
        </div>
      </div>

      {/* Page grid — cards BẰNG NHAU, tên dài ellipsis, căn trái */}
      <div class="login-page-grid" style={{ display: 'grid', 'grid-template-columns': 'repeat(3, minmax(0, 1fr))', gap: '16px', 'max-height': '320px', 'overflow-y': 'auto', 'margin-bottom': '20px', 'padding-right': '8px' }}>
        <Show when={filteredPages().length > 0} fallback={<div style={{ 'grid-column': '1 / -1', padding: '32px', 'text-align': 'center', color: '#6b7280', 'font-size': '14px' }}>Không tìm thấy trang nào</div>}>
        <For each={filteredPages()}>
          {(page) => {
            const isSelected = () => selectedIds().has(page.id);
            return (
              <div
                onClick={() => togglePage(page.id)}
                style={{
                  display: 'flex', 'align-items': 'center', gap: '12px',
                  padding: '12px 14px', cursor: 'pointer',
                  background: isSelected() ? '#eef4ff' : '#fff',
                  border: `1px solid ${isSelected() ? '#1877f2' : '#e5e7eb'}`,
                  'border-radius': '12px',
                  'box-shadow': '0 1px 3px rgba(0,0,0,0.05)',
                  transition: 'all 200ms',
                  position: 'relative',
                  'min-width': 0,
                  width: '100%',
                  'box-sizing': 'border-box',
                }}
              >
                <div style={{ width: '44px', height: '44px', 'border-radius': '12px', overflow: 'hidden', 'flex-shrink': 0, background: page.color ?? '#1877f2', display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: 'white', 'font-weight': '600', 'font-size': '16px' }}>
                  <Show when={page.avatarUrl} fallback={<span>{page.name[0]?.toUpperCase()}</span>}>
                    <img src={page.avatarUrl} style={{ width: '100%', height: '100%', 'object-fit': 'cover' }} alt={page.name} />
                  </Show>
                </div>
                <div style={{ flex: 1, 'min-width': 0, overflow: 'hidden', 'text-align': 'left' }}>
                  <div style={{ 'font-size': '14px', 'font-weight': '600', color: '#1a1a2e', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>{page.name}</div>
                  <div style={{ 'font-size': '12px', color: '#6b7280', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap', 'margin-top': '2px' }}>
                    <span style={{ color: '#1877f2', 'font-weight': '500', 'font-size': '12px' }}>f</span> {page.id}
                  </div>
                </div>
                <Show when={isSelected()}>
                  <div style={{ position: 'absolute', top: '10px', right: '10px', width: '22px', height: '22px', 'border-radius': '50%', background: '#1877f2', display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: 'white', 'flex-shrink': 0, 'box-shadow': '0 2px 8px rgba(24,119,242,0.4)' }}>
                    <IconCheck size={12} />
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
        </Show>
      </div>

      {/* Footer */}
      <div class="login-page-footer" style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', 'flex-wrap': 'wrap', 'padding-top': '20px', 'border-top': '1px solid #e5e7eb', gap: '16px' }}>
        <button
          onClick={toggleSelectAll}
          style={{ display: 'flex', 'align-items': 'center', gap: '10px', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 0', 'font-size': '14px', color: '#6b7280', 'font-weight': '500', transition: 'color 200ms' }}
        >
          <IconSquareStack size={18} />
          <span>Chọn tất cả / bỏ chọn</span>
          <kbd style={{ background: '#f3f4f6', padding: '4px 10px', 'border-radius': '8px', 'font-size': '11px', color: '#4b5563', 'font-weight': '500' }}>⌘ Cmd A</kbd>
        </button>
        <button
          class="login-merge-btn"
          onClick={handleConfirm}
          disabled={selectedIds().size === 0}
          style={{
            display: 'flex', 'align-items': 'center', gap: '10px',
            padding: '12px 24px',
            background: selectedIds().size > 0 ? 'linear-gradient(135deg, #1877f2 0%, #0d5bbf 100%)' : '#e5e7eb',
            color: selectedIds().size > 0 ? 'white' : '#9ca3af',
            border: 'none', 'border-radius': '12px',
            cursor: selectedIds().size > 0 ? 'pointer' : 'default',
            'font-size': '15px', 'font-weight': '600', transition: 'all 200ms',
            'box-shadow': selectedIds().size > 0 ? '0 4px 14px rgba(24,119,242,0.35)' : 'none',
          }}
        >
          <IconLayoutGrid size={18} />
          Vào chế độ gộp trang
        </button>
      </div>
    </div>
  );
};

export interface LoginPageProps {
  onSuccess?: () => void;
}

export const LoginPage = (_props: LoginPageProps) => {
  return (
    <div class="login-page-wrapper" style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'center', background: '#f5f7fa' }}>
      <div class={'login-page-card' + (authState.step === 'select_pages' ? ' login-page-card--wide' : '')} style={{ background: '#ffffff', 'border-radius': '16px', padding: authState.step === 'select_pages' ? '32px 40px' : '48px', width: authState.step === 'select_pages' ? undefined : '520px', 'max-width': authState.step === 'select_pages' ? undefined : '94vw', 'box-sizing': 'border-box', 'box-shadow': '0 4px 24px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)' }}>

        {/* Step indicator */}
        <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'margin-bottom': '24px', 'justify-content': 'center' }}>
          {(['input_token', 'select_pages'] as const).map((s, i) => (
            <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
              <div style={{
                width: '32px', height: '32px', 'border-radius': '50%',
                background: authState.step === s ? '#1877f2' : (authState.step === 'select_pages' && s === 'input_token') ? '#eef4ff' : '#f3f4f6',
                border: 'none',
                display: 'flex', 'align-items': 'center', 'justify-content': 'center',
                'font-size': '13px', 'font-weight': '600',
                color: authState.step === s ? 'white' : (authState.step === 'select_pages' && s === 'input_token') ? '#1877f2' : '#9ca3af',
              }}>
                {authState.step === 'select_pages' && s === 'input_token'
                  ? <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="2,6 5,9 10,3" /></svg>
                  : i + 1}
              </div>
              {i === 0 && <div style={{ width: '48px', height: '2px', background: authState.step === 'select_pages' ? '#1877f2' : '#e5e7eb', 'border-radius': '1px' }} />}
            </div>
          ))}
        </div>

        {/* Steps */}
        <Show when={authState.step === 'input_token'}>
          <InputStep />
        </Show>
        <Show when={authState.step === 'select_pages'}>
          <SelectPagesStep />
        </Show>
      </div>
    </div>
  );
};
