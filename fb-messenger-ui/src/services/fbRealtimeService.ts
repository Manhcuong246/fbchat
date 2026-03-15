const SSE_URL = import.meta.env.VITE_SSE_URL ?? '';

/**
 * Connect to webhook server via Server-Sent Events.
 * When server broadcasts new_message, calls onNewMessage(conversationId).
 * conversationId may be sender PSID (webhook) or conversation id (t_xxx).
 * Returns cleanup (close EventSource).
 *
 * If VITE_SSE_URL is not set, does not connect (avoids ERR_CONNECTION_REFUSED
 * when webhook server is not running). Set e.g. VITE_SSE_URL=http://localhost:3001/events
 * in .env to enable realtime updates.
 */
export function connectSSE(onNewMessage: (conversationId: string) => void): () => void {
  if (!SSE_URL) return () => {};

  const es = new EventSource(SSE_URL);

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'new_message' && data.conversationId) {
        onNewMessage(data.conversationId);
      }
    } catch (_) {}
  };

  es.onerror = () => {
    // SSE auto-reconnects; no extra handling
  };

  return () => es.close();
}
