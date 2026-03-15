import type { LibraryImage } from '../types/library';

const BASE = 'http://localhost:3001/api/library';

export const LibraryService = {
  async getImages(
    pageId: string,
    search = '',
    offset = 0,
    limit = 50
  ): Promise<{ items: LibraryImage[]; total: number }> {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      ...(search ? { search } : {}),
    });
    const res = await fetch(`${BASE}/${pageId}?${params}`);
    if (!res.ok) return { items: [], total: 0 };
    return res.json();
  },

  async uploadImages(pageId: string, files: File[]): Promise<LibraryImage[]> {
    const formData = new FormData();
    files.forEach((file) => formData.append('images', file));
    const res = await fetch(`${BASE}/${pageId}/upload`, { method: 'POST', body: formData });
    if (!res.ok) return [];
    const data = await res.json();
    return data.uploaded || [];
  },

  async deleteImage(pageId: string, imageId: string): Promise<boolean> {
    const res = await fetch(`${BASE}/${pageId}/${imageId}`, { method: 'DELETE' });
    return res.ok;
  },

  async deleteImages(pageId: string, ids: string[]): Promise<boolean> {
    const res = await fetch(`${BASE}/${pageId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    return res.ok;
  },

  async getStats(pageId: string): Promise<{ count: number; totalSizeMB: string }> {
    const res = await fetch(`${BASE}/${pageId}/stats`);
    if (!res.ok) return { count: 0, totalSizeMB: '0' };
    return res.json();
  },
};
