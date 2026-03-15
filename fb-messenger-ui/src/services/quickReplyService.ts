const SERVER_BASE = 'http://localhost:3001/api/quick-replies';

export interface QuickReplyBlock {
  id: string;
  type: 'text' | 'image';
  text?: string;
  imageFile?: string;
  imageName?: string;
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
  if (old?.imageFile) blocks.push({ id: '2', type: 'image', imageFile: String(old.imageFile), imageName: old.imageName });
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

  async save(pageId: string, reply: QuickReply): Promise<boolean> {
    try {
      const res = await fetch(`${SERVER_BASE}/${pageId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reply),
      });
      return res.ok;
    } catch { return false; }
  },

  async delete(pageId: string, replyId: string): Promise<boolean> {
    try {
      const res = await fetch(`${SERVER_BASE}/${pageId}/${replyId}`, { method: 'DELETE' });
      return res.ok;
    } catch { return false; }
  },

  generateId(): string {
    return `qr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  },
};
