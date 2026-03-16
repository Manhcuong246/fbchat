const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Format thời gian tin nhắn gần nhất (timestamp ms).
 * - Trong 24 giờ: hiển thị giờ phút chính xác (vd. "10:46")
 * - Quá 24 giờ: hiển thị ngày tháng và giờ (vd. "15/01 10:46")
 */
export function formatLastSeen(timestamp: number): string {
  if (!timestamp || timestamp <= 0) return '';
  const d = new Date(timestamp);
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < DAY_MS) {
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }
  const dateStr = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  const timeStr = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr} ${timeStr}`;
}
