import { Comment } from '../../database/models/Comment';
import { Post } from '../../database/models/Post';
import { User } from '../../database/models/User';
import { forbidden, notFound, conflict } from '../../utils/errors';
import { buildPage } from '../../utils/pagination';
import { activeRole, hiddenUserIds, isBlockedBetween, ROLE_RANK } from '../common/access';
import { userSummary } from '../common/serializers';
import { notify } from '../notifications/notify';
import { loadVisiblePost } from './posts.service';
import type { CommunityRole } from '../../shared/index';

const EDIT_WINDOW_MS = 30 * 60_000;

type CommentLean = { _id: unknown; post: unknown; author: unknown; parent?: unknown; body: string; status: string; replyCount: number; createdAt: Date; editedAt?: Date | null };

async function serialize(rows: CommentLean[]) {
  const users = await User.find({ _id: { $in: [...new Set(rows.map((r) => String(r.author)))] } }).select('username displayName avatarUrl').lean();
  const map = new Map(users.map((u) => [String(u._id), u]));
  return rows.map((c) => ({
    id: String(c._id),
    postId: String(c.post),
    parentId: c.parent ? String(c.parent) : null,
    body: c.status === 'deleted' ? '' : c.body,
    deleted: c.status === 'deleted',
    replyCount: c.replyCount,
    createdAt: c.createdAt.toISOString(),
    editedAt: c.editedAt ? c.editedAt.toISOString() : null,
    author: c.status === 'deleted' ? null : userSummary(map.get(String(c.author))),
  }));
}

export async function listComments(userId: string, postId: string, q: { cursor?: string; limit: number }) {
  await loadVisiblePost(postId, userId);
  const hidden = await hiddenUserIds(userId);
  const filter: Record<string, unknown> = { post: postId, parent: null, author: { $nin: hidden } };
  if (q.cursor) filter._id = { $gt: q.cursor }; // oldest first
  const rows = await Comment.find(filter).sort({ _id: 1 }).limit(q.limit + 1).lean();
  const { items, meta } = buildPage(rows, q.limit);
  return { items: await serialize(items as unknown as CommentLean[]), meta };
}

export async function listReplies(userId: string, commentId: string, q: { cursor?: string; limit: number }) {
  const parent = await Comment.findById(commentId).lean();
  if (!parent) throw notFound('Comment not found');
  await loadVisiblePost(String(parent.post), userId);
  const hidden = await hiddenUserIds(userId);
  const filter: Record<string, unknown> = { parent: commentId, author: { $nin: hidden } };
  if (q.cursor) filter._id = { $gt: q.cursor };
  const rows = await Comment.find(filter).sort({ _id: 1 }).limit(q.limit + 1).lean();
  const { items, meta } = buildPage(rows, q.limit);
  return { items: await serialize(items as unknown as CommentLean[]), meta };
}

export async function addComment(userId: string, postId: string, body: string, parentId?: string) {
  const post = await loadVisiblePost(postId, userId);
  if (await isBlockedBetween(String(post.author), userId)) throw forbidden('You cannot comment on this post');

  let root: { _id: unknown; author: unknown } | null = null;
  let replyTarget: { author: unknown } | null = null;
  if (parentId) {
    const parent = await Comment.findOne({ _id: parentId, post: postId, status: 'published' }).lean();
    if (!parent) throw notFound('Comment not found');
    replyTarget = parent;
    // Single nesting level: reply to a reply attaches to the same top-level comment.
    root = parent.parent ? await Comment.findById(parent.parent).lean() : parent;
    if (!root) throw notFound('Comment not found');
  }
  const comment = await Comment.create({ post: postId, author: userId, parent: root?._id ?? null, body });
  await Post.updateOne({ _id: postId }, { $inc: { commentCount: 1 } });
  if (root) await Comment.updateOne({ _id: root._id }, { $inc: { replyCount: 1 } });

  if (replyTarget) await notify({ recipient: replyTarget.author, actor: userId, type: 'reply', resourceType: 'post', resourceId: postId });
  else await notify({ recipient: post.author, actor: userId, type: 'comment', resourceType: 'post', resourceId: postId });
  return (await serialize([comment.toObject() as unknown as CommentLean]))[0]!;
}

export async function editComment(userId: string, commentId: string, body: string) {
  const c = await Comment.findOne({ _id: commentId, status: 'published' });
  if (!c || String(c.author) !== userId) throw notFound('Comment not found');
  if (Date.now() - c.createdAt.getTime() > EDIT_WINDOW_MS) throw conflict('Comments can only be edited for 30 minutes', 'EDIT_WINDOW_CLOSED');
  c.body = body;
  c.editedAt = new Date();
  await c.save();
  return (await serialize([c.toObject() as unknown as CommentLean]))[0]!;
}

export async function deleteComment(userId: string, commentId: string) {
  const c = await Comment.findOne({ _id: commentId, status: 'published' });
  if (!c) throw notFound('Comment not found');
  const post = await Post.findById(c.post).select('community').lean();
  let allowed = String(c.author) === userId;
  if (!allowed && post?.community) {
    const role = await activeRole(post.community, userId);
    allowed = !!role && ROLE_RANK[role as CommunityRole] >= ROLE_RANK.moderator;
  }
  if (!allowed) throw forbidden();
  c.status = 'deleted';
  c.body = '';
  await c.save();
  await Post.updateOne({ _id: c.post }, { $inc: { commentCount: -1 } });
}
