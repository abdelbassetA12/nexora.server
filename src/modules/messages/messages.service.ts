import type { CreateConversationInput, SendMessageInput } from '../../shared/index';
import { Conversation } from '../../database/models/Conversation';
import { ConversationMember } from '../../database/models/ConversationMember';
import { Follow } from '../../database/models/Follow';
import { Message } from '../../database/models/Message';
import { User } from '../../database/models/User';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { buildPage } from '../../utils/pagination';
import { isBlockedBetween } from '../common/access';
import { userSummary } from '../common/serializers';
import { emitToConversation, joinUserToConversation, removeUserFromConversation } from '../../sockets/io';

const EDIT_WINDOW_MS = 15 * 60_000;
const preview = (s: string) => s.slice(0, 140);

/** Membership gate used by REST and sockets. Non-members get 404 so conversation existence is not revealed. */
export async function requireMember(conversationId: string, userId: string) {
  const member = await ConversationMember.findOne({ conversation: conversationId, user: userId, status: 'active' });
  if (!member) throw notFound('Conversation not found');
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw notFound('Conversation not found');
  return { conversation, member };
}

export async function activeConversationIds(userId: string, limit = 500): Promise<string[]> {
  const rows = await ConversationMember.find({ user: userId, status: 'active' }).sort({ conversationLastMessageAt: -1 }).limit(limit).select('conversation').lean();
  return rows.map((r) => String(r.conversation));
}

type MessageLean = { _id: unknown; conversation: unknown; sender: unknown; body: string; clientMsgId: string; replyTo?: unknown; status: string; createdAt: Date; editedAt?: Date | null };

export async function serializeMessages(rows: MessageLean[]) {
  const senders = await User.find({ _id: { $in: [...new Set(rows.map((r) => String(r.sender)))] } }).select('username displayName avatarUrl').lean();
  const sMap = new Map(senders.map((s) => [String(s._id), s]));
  const replyIds = rows.map((r) => r.replyTo).filter(Boolean);
  const replies = replyIds.length ? await Message.find({ _id: { $in: replyIds } }).select('body sender status').lean() : [];
  const rMap = new Map(replies.map((r) => [String(r._id), r]));
  return rows.map((m) => {
    const deleted = m.status === 'deleted';
    const reply = m.replyTo ? rMap.get(String(m.replyTo)) : null;
    return {
      id: String(m._id),
      conversationId: String(m.conversation),
      clientMsgId: m.clientMsgId,
      sender: userSummary(sMap.get(String(m.sender))),
      body: deleted ? '' : m.body,
      deleted,
      replyTo: reply ? { id: String(reply._id), body: reply.status === 'deleted' ? '' : preview(reply.body), senderId: String(reply.sender) } : null,
      createdAt: m.createdAt.toISOString(),
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    };
  });
}

async function assertCanMessage(creatorId: string, targetId: string) {
  const target = await User.findOne({ _id: targetId, status: 'active' }).select('privacy').lean();
  if (!target) throw notFound('User not found');
  if (await isBlockedBetween(creatorId, targetId)) throw forbidden('You cannot message this user');
  const perm = target.privacy?.dmPermission ?? 'everyone';
  if (perm === 'nobody') throw forbidden('This user does not accept messages');
  if (perm === 'following' && !(await Follow.exists({ follower: targetId, following: creatorId }))) {
    throw forbidden('This user only accepts messages from people they follow');
  }
}

export async function createConversation(userId: string, input: CreateConversationInput) {
  if (input.type === 'direct') {
    if (input.userId === userId) throw badRequest('You cannot message yourself');
    const key = [userId, input.userId].sort().join(':');
    let conversation = await Conversation.findOne({ directKey: key });
    if (!conversation) {
      await assertCanMessage(userId, input.userId);
      try {
        conversation = await Conversation.create({ type: 'direct', createdBy: userId, directKey: key });
        await ConversationMember.insertMany([{ conversation: conversation._id, user: userId, role: 'owner' }, { conversation: conversation._id, user: input.userId }]);
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
        conversation = await Conversation.findOne({ directKey: key }); // concurrent creation: reuse
      }
    } else {
      // Re-activate my side if I had hidden it; blocks still apply.
      if (await isBlockedBetween(userId, input.userId)) throw forbidden('You cannot message this user');
      await ConversationMember.updateOne({ conversation: conversation._id, user: userId }, { status: 'active' });
    }
    joinUserToConversation(userId, String(conversation!._id));
    joinUserToConversation(input.userId, String(conversation!._id));
    return getConversation(userId, String(conversation!._id));
  }

  const ids = [...new Set(input.memberIds)].filter((i) => i !== userId);
  if (!ids.length) throw badRequest('Add at least one other member');
  for (const id of ids) await assertCanMessage(userId, id);
  const conversation = await Conversation.create({ type: 'group', title: input.title, createdBy: userId });
  await ConversationMember.insertMany([{ conversation: conversation._id, user: userId, role: 'owner' }, ...ids.map((id) => ({ conversation: conversation._id, user: id }))]);
  for (const id of [userId, ...ids]) joinUserToConversation(id, String(conversation._id));
  return getConversation(userId, String(conversation._id));
}

async function unreadFor(conversationId: unknown, member: { user: unknown; lastReadMessage?: unknown }) {
  const filter: Record<string, unknown> = { conversation: conversationId, sender: { $ne: member.user }, status: 'sent' };
  if (member.lastReadMessage) filter._id = { $gt: member.lastReadMessage };
  return Message.countDocuments(filter);
}

async function serializeConversation(conversation: InstanceType<typeof Conversation>, viewerId: string, member: { user: unknown; muted: boolean; lastReadMessage?: unknown }) {
  const members = await ConversationMember.find({ conversation: conversation._id, status: 'active' }).select('user role').lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.user) } }).select('username displayName avatarUrl').lean();
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  const other = conversation.type === 'direct' ? members.find((m) => String(m.user) !== viewerId) : null;
  return {
    id: String(conversation._id),
    type: conversation.type,
    title: conversation.type === 'group' ? conversation.title ?? '' : userSummary(other ? uMap.get(String(other.user)) : null)?.displayName ?? '',
    members: members.map((m) => ({ role: m.role, user: userSummary(uMap.get(String(m.user))) })),
    lastMessage: conversation.lastMessage?.id ? { id: String(conversation.lastMessage.id), preview: conversation.lastMessage.preview ?? '', senderId: String(conversation.lastMessage.sender) } : null,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    muted: member.muted,
    unreadCount: await unreadFor(conversation._id, member),
  };
}

export async function getConversation(userId: string, conversationId: string) {
  const { conversation, member } = await requireMember(conversationId, userId);
  return serializeConversation(conversation, userId, member);
}

export async function listConversations(userId: string, q: { before?: number; limit: number }) {
  const filter: Record<string, unknown> = { user: userId, status: 'active' };
  if (q.before) filter.conversationLastMessageAt = { $lt: new Date(q.before) };
  const members = await ConversationMember.find(filter).sort({ conversationLastMessageAt: -1 }).limit(q.limit + 1);
  const hasMore = members.length > q.limit;
  const page = hasMore ? members.slice(0, q.limit) : members;
  const conversations = await Conversation.find({ _id: { $in: page.map((m) => m.conversation) } });
  const cMap = new Map(conversations.map((c) => [String(c._id), c]));
  const items = [];
  for (const m of page) {
    const c = cMap.get(String(m.conversation));
    if (c) items.push(await serializeConversation(c, userId, m));
  }
  const last = page[page.length - 1];
  return { items, nextCursor: hasMore && last ? String(last.conversationLastMessageAt.getTime()) : null };
}

/** `cursor` pages backwards (older, descending); `after` is for reconnect sync (newer, ascending). */
export async function listMessages(userId: string, conversationId: string, q: { cursor?: string; after?: string; limit: number }) {
  await requireMember(conversationId, userId);
  if (q.after) {
    const rows = await Message.find({ conversation: conversationId, _id: { $gt: q.after } }).sort({ _id: 1 }).limit(q.limit).lean();
    return { items: await serializeMessages(rows as never), meta: { nextCursor: null as string | null, limit: q.limit } };
  }
  const filter: Record<string, unknown> = { conversation: conversationId };
  if (q.cursor) filter._id = { $lt: q.cursor };
  const rows = await Message.find(filter).sort({ _id: -1 }).limit(q.limit + 1).lean();
  const { items, meta } = buildPage(rows, q.limit);
  return { items: await serializeMessages(items as never), meta };
}

export async function sendMessage(userId: string, conversationId: string, input: SendMessageInput) {
  const { conversation } = await requireMember(conversationId, userId);

  // Idempotent retry: return the already-persisted message.
  const existing = await Message.findOne({ conversation: conversationId, sender: userId, clientMsgId: input.clientMsgId }).lean();
  if (existing) return { message: (await serializeMessages([existing as never]))[0]!, created: false };

  if (conversation.type === 'direct') {
    const other = await ConversationMember.findOne({ conversation: conversationId, user: { $ne: userId } }).select('user').lean();
    if (other && (await isBlockedBetween(userId, String(other.user)))) throw forbidden('You cannot message this user');
  }
  if (input.replyTo && !(await Message.exists({ _id: input.replyTo, conversation: conversationId }))) throw badRequest('Reply target not found in this conversation');

  let doc;
  try {
    doc = await Message.create({ conversation: conversationId, sender: userId, body: input.body, clientMsgId: input.clientMsgId, replyTo: input.replyTo ?? null });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      const again = await Message.findOne({ conversation: conversationId, sender: userId, clientMsgId: input.clientMsgId }).lean();
      if (again) return { message: (await serializeMessages([again as never]))[0]!, created: false };
    }
    throw e;
  }
  // Persisted. Everything below is best effort metadata; the message is already durable.
  await Conversation.updateOne({ _id: conversationId }, { lastMessage: { id: doc._id, preview: preview(input.body), sender: userId }, lastMessageAt: doc.createdAt });
  await ConversationMember.updateMany({ conversation: conversationId }, { conversationLastMessageAt: doc.createdAt });
  const message = (await serializeMessages([doc.toObject() as never]))[0]!;
  emitToConversation(conversationId, 'message:new', message);
  return { message, created: true };
}

export async function markRead(userId: string, conversationId: string, messageId?: string) {
  const { member } = await requireMember(conversationId, userId);
  const target = messageId
    ? await Message.findOne({ _id: messageId, conversation: conversationId }).select('_id').lean()
    : await Message.findOne({ conversation: conversationId }).sort({ _id: -1 }).select('_id').lean();
  if (!target) return { lastReadMessageId: null };
  // Never move the read marker backwards.
  if (!member.lastReadMessage || String(target._id) > String(member.lastReadMessage)) {
    member.lastReadMessage = target._id as never;
    member.lastReadAt = new Date();
    await member.save();
    emitToConversation(conversationId, 'message:read', { conversationId, userId, messageId: String(target._id) });
  }
  return { lastReadMessageId: String(member.lastReadMessage) };
}

export async function editMessage(userId: string, messageId: string, body: string) {
  const m = await Message.findOne({ _id: messageId, sender: userId, status: 'sent' });
  if (!m) throw notFound('Message not found');
  await requireMember(String(m.conversation), userId);
  if (Date.now() - m.createdAt.getTime() > EDIT_WINDOW_MS) throw conflict('Messages can only be edited for 15 minutes', 'EDIT_WINDOW_CLOSED');
  m.body = body;
  m.editedAt = new Date();
  await m.save();
  const message = (await serializeMessages([m.toObject() as never]))[0]!;
  emitToConversation(String(m.conversation), 'message:updated', message);
  return message;
}

export async function deleteMessage(userId: string, messageId: string) {
  const m = await Message.findOne({ _id: messageId, sender: userId, status: 'sent' });
  if (!m) throw notFound('Message not found');
  await requireMember(String(m.conversation), userId);
  m.status = 'deleted';
  m.body = '';
  await m.save();
  await Conversation.updateOne({ _id: m.conversation, 'lastMessage.id': m._id }, { 'lastMessage.preview': '' });
  emitToConversation(String(m.conversation), 'message:deleted', { id: String(m._id), conversationId: String(m.conversation) });
}

export async function setMuted(userId: string, conversationId: string, muted: boolean) {
  const { member } = await requireMember(conversationId, userId);
  member.muted = muted;
  await member.save();
  return { muted };
}

export async function leaveConversation(userId: string, conversationId: string) {
  const { conversation, member } = await requireMember(conversationId, userId);
  if (conversation.type === 'direct') throw conflict('Direct conversations cannot be left', 'CANNOT_LEAVE_DIRECT');
  member.status = 'left';
  await member.save();
  removeUserFromConversation(userId, conversationId);
  if (member.role === 'owner') {
    const next = await ConversationMember.findOne({ conversation: conversationId, status: 'active' }).sort({ _id: 1 });
    if (next) { next.role = 'owner'; await next.save(); }
  }
}
