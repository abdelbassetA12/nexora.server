import type { REACTION_TYPES } from '../../shared/index';
import { Comment } from '../../database/models/Comment';
import { Post } from '../../database/models/Post';
import { Reaction } from '../../database/models/Reaction';
import { SavedItem } from '../../database/models/SavedItem';
import { conflict, forbidden, notFound } from '../../utils/errors';
import { buildPage } from '../../utils/pagination';
import { notify } from '../notifications/notify';
import { award } from '../achievements/achievements';
import { canModeratePost, loadVisiblePost, serializePosts } from './posts.service';

export async function react(userId: string, postId: string, type: (typeof REACTION_TYPES)[number]) {
  const post = await loadVisiblePost(postId, userId);
  try {
    await Reaction.create({ post: postId, user: userId, type });
    await Post.updateOne({ _id: postId }, { $inc: { reactionCount: 1 } });
    await notify({ recipient: post.author, actor: userId, type: 'reaction', resourceType: 'post', resourceId: postId });
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
    // Already reacted: switching type must not change the counter.
    await Reaction.updateOne({ post: postId, user: userId }, { type });
  }
  const fresh = await Post.findById(postId).select('reactionCount').lean();
  return { myReaction: type, reactionCount: fresh?.reactionCount ?? 0 };
}

export async function unreact(userId: string, postId: string) {
  await loadVisiblePost(postId, userId);
  const res = await Reaction.deleteOne({ post: postId, user: userId });
  if (res.deletedCount) await Post.updateOne({ _id: postId }, { $inc: { reactionCount: -1 } });
  const fresh = await Post.findById(postId).select('reactionCount').lean();
  return { myReaction: null, reactionCount: fresh?.reactionCount ?? 0 };
}

export async function save(userId: string, postId: string) {
  await loadVisiblePost(postId, userId);
  await SavedItem.updateOne({ user: userId, post: postId }, { $setOnInsert: { user: userId, post: postId } }, { upsert: true });
  return { saved: true };
}

export async function unsave(userId: string, postId: string) {
  await SavedItem.deleteOne({ user: userId, post: postId });
  return { saved: false };
}

export async function listSaved(userId: string, q: { cursor?: string; limit: number }) {
  const filter: Record<string, unknown> = { user: userId };
  if (q.cursor) filter._id = { $lt: q.cursor };
  const rows = await SavedItem.find(filter).sort({ _id: -1 }).limit(q.limit + 1).lean();
  const { items, meta } = buildPage(rows, q.limit);
  const posts = await Post.find({ _id: { $in: items.map((i) => i.post) }, status: 'published' }).lean();
  // Posts that became invisible (removed, private community left) are silently omitted.
  const visible = [];
  for (const p of posts) {
    try { await loadVisiblePost(String(p._id), userId); visible.push(p); } catch { /* skip */ }
  }
  const order = new Map(items.map((i, idx) => [String(i.post), idx]));
  visible.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));
  return { items: await serializePosts(visible as never, userId), meta };
}

export async function acceptAnswer(userId: string, questionId: string, commentId: string) {
  const post = await loadVisiblePost(questionId, userId);
  if (post.type !== 'question') throw conflict('Only questions can have an accepted answer', 'NOT_A_QUESTION');
  if (!(await canModeratePost(post, userId))) throw forbidden('Only the author or a moderator can accept an answer');
  const comment = await Comment.findOne({ _id: commentId, post: questionId, parent: null, status: 'published' });
  if (!comment) throw notFound('Answer not found');
  post.acceptedComment = comment._id;
  await post.save();
  await notify({ recipient: comment.author, actor: userId, type: 'accepted_answer', resourceType: 'post', resourceId: post._id });
  if (String(comment.author) !== userId) await award(comment.author, 'first_accepted_answer', 'answer', comment._id); // never for accepting your own answer
  return { acceptedCommentId: String(comment._id) };
}
