# Webhook — Nhận tin khi gửi từ Pancake / bên ngoài

Để app tự cập nhật khi bạn gửi tin từ **Pancake** (hoặc bất kỳ nơi nào khác dùng cùng Page):

1. **Facebook gửi webhook** `message_echo` tới server của bạn khi page gửi tin.
2. **Server phải nhận được** request từ Facebook → URL webhook phải **public** (Facebook không gửi được tới `localhost`).

## Cách làm (khi chạy server trên máy local)

1. Dùng **ngrok** (hoặc công cụ tương tự) để tạo URL public trỏ tới port server (ví dụ 3001):

   ```bash
   ngrok http 3001
   ```

2. Copy URL dạng `https://xxxx.ngrok.io`.

3. Vào **Facebook Developer** → App → **Webhooks** → chỉnh URL Callback thành:
   `https://xxxx.ngrok.io/webhook`  
   (đúng path `/webhook` như trong code).

4. Subscribe page với `message_echoes` (app đã gọi `subscribed_fields=...,message_echoes,...` khi login).

5. Khi bạn gửi tin từ Pancake:
   - Facebook gửi POST tới `https://xxxx.ngrok.io/webhook` với event `message_echo`.
   - Server lưu tin vào DB, xóa cache, broadcast qua Socket.io.
   - App (tab đang mở) nhận event và refetch tin + cập nhật danh sách hội thoại → tin hiện đúng chỗ.

**Lưu ý:** Mỗi lần mở ngrok mới URL đổi → phải cập nhật lại URL trong Facebook Webhooks.
