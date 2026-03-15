# Chat Engine — Message Engine kiểu Pancake

Module quản lý tin nhắn chuẩn hóa, tối ưu hiệu năng với SolidJS Store.

## Kiến trúc dữ liệu (Normalized Store)

```
{
  [conversationId]: {
    messages: { [messageId]: MessageObj },  // O(1) truy cập
    order: [messageId1, messageId2, ...],
    beforeCursor: string | null,
    loading: boolean,
    loadingMore: boolean
  }
}
```

## Chiến lược Cache (Pancake-style)

1. **Load Cache**: Khi mở hội thoại → ưu tiên Store, không có thì LocalStorage
2. **Update Cache**: Chỉ gọi API fetch latest → merge tin mới vào Store (reconcile)
3. **Reconcile**: Giữ tham chiếu object, không làm mất reference → hiệu năng cao

## Đồng bộ gửi/nhận

- **Outgoing**: tempId (UUID) + status `sending` → push ngay vào Store
- **Ack**: Server trả về realId → đổi tempId→realId, giữ rowId (không nháy UI)
- **Incoming**: Socket có ID trùng → update; chưa có → push cuối

## Virtual Scroll

Để chỉ render tin trong viewport:

1. **solid-virtual** (nếu dùng thư viện):
   ```bash
   npm install @solid-primitives/virtual
   ```
   ```tsx
   import { createVirtualizer } from '@solid-primitives/virtual';
   const virtualizer = createVirtualizer({ ... });
   ```

2. **Logic tự viết**:
   - Đo viewport height + scrollTop
   - Tính `startIndex`, `endIndex` từ `itemHeight` (ước lượng hoặc đo)
   - Chỉ map `messages.slice(startIndex, endIndex + 1)`
   - Dùng `paddingTop`, `paddingBottom` để giữ scrollHeight

## Sử dụng

```ts
import { createChatEngine, createSocketIoAdapter } from './engines/chatEngine';

const engine = createChatEngine({
  fetchLatest: async ({ conversationId, pageId }) => { ... },
  sendMessage: async (opts) => { ... },
  resolveConvId: async (pageId, participantId) => { ... },
  getPageIdForConv: (convId) => { ... },
});

// Mở hội thoại
engine.loadCache(convId) || engine.updateCache(convId, pageId);

// Gửi
await engine.send(convId, pageId, recipientId, { text: 'Hi' }, { pageName: 'Page' });

// Socket
const disconnect = engine.connectSocket(createSocketIoAdapter(socket));
```
