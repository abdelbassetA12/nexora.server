import type { Types } from 'mongoose';
import type { CreatePostInput } from '../../shared/index';
import { Community } from '../../database/models/Community';
import { CommunityMembership } from '../../database/models/CommunityMembership';
import { Follow } from '../../database/models/Follow';
import { Post } from '../../database/models/Post';
import { Reaction } from '../../database/models/Reaction';
import { SavedItem } from '../../database/models/SavedItem';
import { User } from '../../database/models/User';
import { forbidden, notFound } from '../../utils/errors';
import { buildPage } from '../../utils/pagination';
import {
  ROLE_RANK, activeRole, findCommunity, hiddenUserIds, isBlockedBetween, myActiveCommunityIds,
} from '../common/access';
import { userSummary } from '../common/serializers';
import type { CommunityRole } from '../../shared/index';

type PostLean = {
  _id: Types.ObjectId; author: unknown; community: unknown; visibility: string; type: string; title?: string | null;
  body: string; tags: string[]; linkUrl?: string | null; pinned: boolean; acceptedComment?: unknown;
  commentCount: number; reactionCount: number; createdAt: Date; editedAt?: Date | null;
};

/** Attaches author, community and the viewer's own reaction/save state in three batched queries. */
export async function serializePosts(rows: PostLean[], viewerId: string) {
  const ids = rows.map((r) => r._id);
  const authorIds = [...new Set(rows.map((r) => String(r.author)))];
  const communityIds = [...new Set(rows.filter((r) => r.community).map((r) => String(r.community)))];
  const [authors, communities, reactions, saves] = await Promise.all([
    User.find({ _id: { $in: authorIds } }).select('username displayName avatarUrl').lean(),
    Community.find({ _id: { $in: communityIds } }).select('name slug').lean(),
    Reaction.find({ user: viewerId, post: { $in: ids } }).select('post type').lean(),
    SavedItem.find({ user: viewerId, post: { $in: ids } }).select('post').lean(),
  ]);
  const aMap = new Map(authors.map((a) => [String(a._id), a]));
  const cMap = new Map(communities.map((c) => [String(c._id), c]));
  const rMap = new Map(reactions.map((r) => [String(r.post), r.type]));
  const sSet = new Set(saves.map((s) => String(s.post)));
  return rows.map((p) => {
    const c = p.community ? cMap.get(String(p.community)) : null;
    return {
      id: String(p._id),
      type: p.type,
      title: p.title ?? null,
      body: p.body,
      tags: p.tags,
      linkUrl: p.linkUrl ?? null,
      pinned: p.pinned,
      acceptedCommentId: p.acceptedComment ? String(p.acceptedComment) : null,
      commentCount: p.commentCount,
      reactionCount: p.reactionCount,
      createdAt: p.createdAt.toISOString(),
      editedAt: p.editedAt ? p.editedAt.toISOString() : null,
      author: userSummary(aMap.get(String(p.author))),
      community: c ? { id: String(c._id), name: c.name, slug: c.slug } : null,
      myReaction: rMap.get(String(p._id)) ?? null,
      saved: sSet.has(String(p._id)),
    };
  });
}

/** Loads a post the viewer is allowed to see, otherwise 404 (never reveals that it exists). */
export async function loadVisiblePost(postId: string, viewerId: string) {
  const post = await Post.findOne({ _id: postId, status: 'published' });
  if (!post) throw notFound('Post not found');
  if (post.visibility === 'community' && !(await activeRole(post.community, viewerId))) throw notFound('Post not found');
  if (await isBlockedBetween(String(post.author), viewerId)) throw notFound('Post not found');
  return post;
}

export async function createPost(userId: string, input: CreatePostInput) {
  let visibility: 'public' | 'community' = 'public';
  if (input.community) {
    const community = await findCommunity(input.community);
    const m = await CommunityMembership.findOne({ community: community._id, user: userId });
    if (!m || m.status !== 'active') throw forbidden('Join this community before posting', 'NOT_A_MEMBER');
    visibility = community.visibility === 'private' ? 'community' : 'public';
  }
  const post = await Post.create({
    author: userId, community: input.community ?? null, visibility, type: input.type,
    title: input.title, body: input.body, tags: [...new Set(input.tags)], linkUrl: input.linkUrl,
  });
  if (input.community) await Community.updateOne({ _id: input.community }, { $inc: { postCount: 1 } });
  return (await serializePosts([post.toObject() as unknown as PostLean], userId))[0]!;
}

export async function getPost(userId: string, postId: string) {
  const post = await loadVisiblePost(postId, userId);
  return (await serializePosts([post.toObject() as unknown as PostLean], userId))[0]!;
}

export async function updatePost(userId: string, postId: string, input: { title?: string; body?: string; tags?: string[] }) {
  const post = await Post.findOne({ _id: postId, status: 'published' });
  if (!post || String(post.author) !== userId) throw notFound('Post not found'); // not the author: indistinguishable from missing
  if (input.title !== undefined) post.title = input.title;
  if (input.body !== undefined) post.body = input.body;
  if (input.tags !== undefined) post.tags = [...new Set(input.tags)];
  post.editedAt = new Date();
  await post.save();
  return (await serializePosts([post.toObject() as unknown as PostLean], userId))[0]!;
}

export async function canModeratePost(post: { community?: unknown; author: unknown }, userId: string) {
  if (String(post.author) === userId) return true;
  if (!post.community) return false;
  const role = await activeRole(post.community, userId);
  return !!role && ROLE_RANK[role as CommunityRole] >= ROLE_RANK.moderator;
}

export async function deletePost(userId: string, postId: string) {
  const post = await Post.findOne({ _id: postId, status: 'published' });
  if (!post) throw notFound('Post not found');
  if (!(await canModeratePost(post, userId))) {
    if (post.visibility === 'community' && !(await activeRole(post.community, userId))) throw notFound('Post not found');
    throw forbidden();
  }
  post.status = 'removed';
  post.removedBy = userId as never;
  await post.save();
  if (post.community) await Community.updateOne({ _id: post.community }, { $inc: { postCount: -1 } });
}

export async function listCommunityPosts(userId: string, idOrSlug: string, q: { cursor?: string; limit: number }) {
  const c = await findCommunity(idOrSlug);
  if (c.visibility === 'private' && !(await activeRole(c._id, userId))) throw forbidden('Members only');
  const hidden = await hiddenUserIds(userId);
  const filter: Record<string, unknown> = { community: c._id, status: 'published', author: { $nin: hidden } };
  if (q.cursor) filter._id = { $lt: q.cursor };
  const rows = await Post.find(filter).sort({ _id: -1 }).limit(q.limit + 1).lean();
  const { items, meta } = buildPage(rows, q.limit);
  return { items: await serializePosts(items as unknown as PostLean[], userId), meta };
}

/**
 * Rule-based feed (transparent, no hidden ranking): newest first from (a) communities the user belongs to,
 * (b) people they follow. If the user has neither, fall back to public posts in communities matching their interests.
 */
export async function getFeed(userId: string, q: { cursor?: string; limit: number }) {
  const [communityIds, follows, hidden, me] = await Promise.all([
    myActiveCommunityIds(userId),
    Follow.find({ follower: userId }).select('following').lean(),
    hiddenUserIds(userId),
    User.findById(userId).select('interests').lean(),
  ]);
  const followedIds = follows.map((f) => f.following);

  let source: Record<string, unknown>;
  if (communityIds.length || followedIds.length) {
    source = { $or: [{ community: { $in: communityIds } }, { author: { $in: followedIds }, visibility: 'public' }] };
  } else {
    const matching = await Community.find({ visibility: 'public', status: 'active', category: { $in: me?.interests ?? [] } }).select('_id').limit(50).lean();
    source = { community: { $in: matching.map((m) => m._id) } };
  }
  const filter: Record<string, unknown> = { status: 'published', author: { $nin: hidden }, ...source };
  if (q.cursor) filter._id = { $lt: q.cursor };
  const rows = await Post.find(filter).sort({ _id: -1 }).limit(q.limit + 1).lean();
  const { items, meta } = buildPage(rows, q.limit);
  return { items: await serializePosts(items as unknown as PostLean[], userId), meta };
}
