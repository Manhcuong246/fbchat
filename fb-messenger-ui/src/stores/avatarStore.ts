import { createStore } from 'solid-js/store';

/** psid -> data URL (base64). Gọi 1 lần batch, dùng cho tất cả avatar. */
const [avatarStore, setAvatarStore] = createStore<Record<string, string>>({});

export { avatarStore, setAvatarStore };
