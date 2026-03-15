export const FB_CONFIG = {
  API_VERSION: 'v19.0',
  BASE_URL: 'https://graph.facebook.com',
  SCOPES: ['pages_messaging', 'pages_read_engagement', 'pages_manage_metadata'],
} as const;

export const buildUrl = (endpoint: string) =>
  `${FB_CONFIG.BASE_URL}/${FB_CONFIG.API_VERSION}${endpoint}`;
