const SERVER_BASE = 'http://localhost:3001/api/quick-replies';

export interface QuickReplyBlock {
  id: string;
  type: 'text' | 'image';
  text?: string;
  /** Base64 data URL — legacy, dùng khi chưa upload thư viện */
  imageFile?: string;
  imageName?: string;
  /** URL ảnh từ thư viện page — dùng khi gửi tin nhắn nhanh */
  imageUrl?: string;
}

export interface QuickReply {
  id: string;
  shortcut: string;
  blocks: QuickReplyBlock[];
  createdAt?: number;
}

// Migration helper — dùng cho data cũ từ localStorage nếu cần
export function migrateOldFormat(old: any): QuickReply {
  if (old && Array.isArray(old.blocks)) return old as QuickReply;
  const blocks: QuickReplyBlock[] = [];
  if (old?.text) blocks.push({ id: '1', type: 'text', text: String(old.text) });
  if (old?.imageUrl) blocks.push({ id: '2', type: 'image', imageUrl: String(old.imageUrl), imageName: old.imageName });
  else if (old?.imageFile) blocks.push({ id: '2', type: 'image', imageFile: String(old.imageFile), imageName: old.imageName });
  return { id: String(old?.id ?? ''), shortcut: String(old?.shortcut ?? ''), blocks };
}

export const QuickReplyService = {
  // ── Server-side (per page) ──
  async getAll(pageId: string): Promise<QuickReply[]> {
    try {
      const res = await fetch(`${SERVER_BASE}/${pageId}`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.replies || []).map(migrateOldFormat);
    } catch { return []; }
  },

  async save(pageId: string, reply: QuickReply): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${SERVER_BASE}/${pageId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reply),
      });
      if (res.ok) return { ok: true };
      let err = `Lỗi ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) err = body.error;
      } catch { /* ignore */ }
      return { ok: false, error: err };
    } catch (e) {
      return { ok: false, error: (e as Error).message || 'Không kết nối được server' };
    }
  },

  async delete(pageId: string, replyId: string): Promise<boolean> {
    try {
      const res = await fetch(`${SERVER_BASE}/${pageId}/${replyId}`, { method: 'DELETE' });
      return res.ok;
    } catch { return false; }
  },

  async export(pageId: string): Promise<{ source_page_id: string; exported_at: number; replies: QuickReply[] }> {
    const res = await fetch(`${SERVER_BASE}/${pageId}/export`);
    if (!res.ok) throw new Error('Export failed');
    return res.json();
  },

  async import(
    pageId: string,
    replies: QuickReply[],
    mode: 'merge' | 'replace'
  ): Promise<{ ok: boolean; total: number; imported: number }> {
    const res = await fetch(`${SERVER_BASE}/${pageId}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replies, mode }),
    });
    if (!res.ok) throw new Error('Import failed');
    return res.json();
  },

  generateId(): string {
    return `qr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  },
};
