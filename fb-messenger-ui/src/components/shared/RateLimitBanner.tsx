import { createSignal, onMount, onCleanup, Show } from 'solid-js';
import { IconWarning } from './Icons';

const RATE_LIMITED_KEY = 'rate_limited_until';

export const RateLimitBanner = () => {
  const [show, setShow] = createSignal(false);
  const [minutesLeft, setMinutesLeft] = createSignal(0);

  onMount(() => {
    const check = () => {
      const until = Number(localStorage.getItem(RATE_LIMITED_KEY) || 0);
      if (Date.now() < until) {
        setShow(true);
        setMinutesLeft(Math.ceil((until - Date.now()) / 60000));
      } else {
        setShow(false);
      }
    };

    check();
    const timer = setInterval(check, 30000);
    onCleanup(() => clearInterval(timer));
  });

  const handleRetry = () => {
    localStorage.removeItem(RATE_LIMITED_KEY);
    setShow(false);
  };

  return (
    <Show when={show()}>
      <div
        style={{
          background: '#fff3cd',
          'border-bottom': '1px solid #ffc107',
          padding: '8px 16px',
          'font-size': '13px',
          color: '#856404',
          display: 'flex',
          'align-items': 'center',
          gap: '8px',
        }}
      >
        <IconWarning size={16} />
        <span>Facebook API đang bị giới hạn tốc độ. Tin nhắn mới sẽ không tự động cập nhật. Reset sau {minutesLeft()} phút.</span>
        <button
          type="button"
          onClick={handleRetry}
          style={{
            'margin-left': 'auto',
            background: 'none',
            border: '1px solid #856404',
            'border-radius': '4px',
            padding: '2px 8px',
            cursor: 'pointer',
            'font-size': '12px',
          }}
        >
          Thử lại
        </button>
      </div>
    </Show>
  );
};
