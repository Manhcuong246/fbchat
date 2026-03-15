const BASE = 'http://localhost:3001/api';

export interface PageSettings {
  pageId: string;
  sendMode: 'single' | 'split';
  autoReply: boolean;
  signature: string;
}

export const SettingsService = {
  async get(pageId: string): Promise<PageSettings> {
    const res = await fetch(`${BASE}/settings/${pageId}`);
    return res.json();
  },

  async save(pageId: string, settings: Partial<PageSettings>): Promise<PageSettings> {
    const res = await fetch(`${BASE}/settings/${pageId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    return res.json();
  },
};
