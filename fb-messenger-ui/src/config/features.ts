export const FEATURES = {
  DARK_MODE: true,
  IMAGE_MESSAGES: true,
  VIDEO_MESSAGES: true,
  ONLINE_STATUS: true,
  TYPING_INDICATOR: true,
  READ_RECEIPTS: true,
} as const;
export const isEnabled = (f: keyof typeof FEATURES) => FEATURES[f];
