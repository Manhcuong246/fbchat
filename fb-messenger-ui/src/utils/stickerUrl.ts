/**
 * Chuyển URL sticker sang phiên bản độ phân giải cao.
 * - em-content thumbs/160 -> thumbs/512
 * - Twemoji 72x72 -> 72x72 (giữ, Twemoji không có 512)
 * - fbcdn.net: giữ nguyên
 */
const EMOJI_CDN_512 = 'https://em-content.zobj.net/thumbs/512/facebook/355';

function extractEmojiCdnName(url: string): string | null {
  const m = url.match(/\/facebook\/355\/([^/]+\.png)$/);
  return m ? m[1] : null;
}

export function toHighResStickerUrl(url: string | null | undefined): string {
  if (!url || typeof url !== 'string') return url || '';

  // em-content: thumbs/160 -> thumbs/512 (độ phân giải cao)
  if (url.includes('em-content.zobj.net') && url.includes('thumbs/160')) {
    const name = extractEmojiCdnName(url);
    if (name) return `${EMOJI_CDN_512}/${name}`;
    return url.replace('thumbs/160', 'thumbs/512');
  }

  // em-content: thumbs/72 hoặc thumbs nhỏ khác -> 512
  if (url.includes('em-content.zobj.net') && url.match(/thumbs\/\d+/)) {
    return url.replace(/thumbs\/\d+/, 'thumbs/512');
  }

  return url;
}
