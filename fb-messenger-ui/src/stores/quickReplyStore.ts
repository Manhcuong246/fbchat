import { createStore } from 'solid-js/store';
import { QuickReplyService, type QuickReply } from '../services/quickReplyService';

const [quickReplies, setQuickReplies] = createStore<QuickReply[]>([]);

export { quickReplies, setQuickReplies };

export async function loadQuickReplies(pageId: string): Promise<void> {
  const list = await QuickReplyService.getAll(pageId);
  setQuickReplies(list);
}

export async function addQuickReply(pageId: string, reply: QuickReply): Promise<void> {
  await QuickReplyService.save(pageId, reply);
  const list = await QuickReplyService.getAll(pageId);
  setQuickReplies(list);
}

export async function updateQuickReply(pageId: string, reply: QuickReply): Promise<void> {
  await QuickReplyService.save(pageId, reply);
  const list = await QuickReplyService.getAll(pageId);
  setQuickReplies(list);
}

export async function deleteQuickReply(pageId: string, replyId: string): Promise<void> {
  await QuickReplyService.delete(pageId, replyId);
  const list = await QuickReplyService.getAll(pageId);
  setQuickReplies(list);
}
