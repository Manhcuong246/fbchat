const MIN_5_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Format "last seen" from timestamp (ms).
 * - under 5 min ago → "vừa hoạt động"
 * - under 1 hour → "X phút trước"
 * - under 24 hours → "X giờ trước"
 * - else → date (e.g. "15/01")
 */
export function formatLastSeen(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 0) return 'vừa hoạt động';
  if (diff < MIN_5_MS) return 'vừa hoạt động';
  if (diff < HOUR_MS) {
    const mins = Math.floor(diff / 60000);
    return mins <= 1 ? '1 phút trước' : `${mins} phút trước`;
  }
  if (diff < DAY_MS) {
    const hours = Math.floor(diff / HOUR_MS);
    return hours <= 1 ? '1 giờ trước' : `${hours} giờ trước`;
  }
  const d = new Date(timestamp);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}
