import { Router } from 'express';
import { searchQuerySchema } from '../../shared/index';
import { Community } from '../../database/models/Community';
import { Post } from '../../database/models/Post';
import { User } from '../../database/models/User';
import { UserSkill } from '../../database/models/UserSkill';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler, ok } from '../../utils/http';
import { buildPage } from '../../utils/pagination';
import { escapeRegex, hiddenUserIds, myActiveCommunityIds } from '../common/access';
import { serializeCommunity } from '../communities/communities.service';
import { userSummary } from '../common/serializers';
import { serializePosts } from '../posts/posts.service';

type Q = { q: string; cursor?: string; limit: number };
const router = Router();
router.use(authenticate);
const qv = validate({ query: searchQuerySchema });

/*
 * Search is isolated behind these functions so MongoDB text/prefix search can later be replaced by a
 * dedicated engine without touching routes. All of them respect blocks and community visibility.
 */
async function searchUsers(userId: string, { q, cursor, limit }: Q) {
  const hidden = await hiddenUserIds(userId);
  const rx = new RegExp(`^${escapeRegex(q)}`, 'i');
  const filter: Record<string, unknown> = { status: 'active', _id: { $nin: [...hidden, userId] }, $or: [{ usernameNormalized: rx }, { displayName: rx }] };
  if (cursor) (filter._id as Record<string, unknown>).$lt = cursor;
  const rows = await User.find(filter).sort({ _id: -1 }).limit(limit + 1).select('username displayName avatarUrl').lean();
  const { items, meta } = buildPage(rows, limit);
  return { items: items.map((u) => userSummary(u)), meta };
}

async function searchCommunities(userId: string, { q, cursor, limit }: Q) {
  const mine = await myActiveCommunityIds(userId);
  const filter: Record<string, unknown> = { status: 'active', $text: { $search: q }, $or: [{ visibility: 'public' }, { _id: { $in: mine } }] };
  if (cursor) filter._id = { $lt: cursor };
  const rows = await Community.find(filter).sort({ _id: -1 }).limit(limit + 1);
  const { items, meta } = buildPage(rows, limit);
  return { items: items.map((c) => serializeCommunity(c as never)), meta };
}

async function searchPosts(userId: string, { q, cursor, limit }: Q) {
  const [mine, hidden] = await Promise.all([myActiveCommunityIds(userId), hiddenUserIds(userId)]);
  const filter: Record<string, unknown> = {
    status: 'published', $text: { $search: q }, author: { $nin: hidden },
    $or: [{ visibility: 'public' }, { community: { $in: mine } }],
  };
  if (cursor) filter._id = { $lt: cursor };
  const rows = await Post.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const { items, meta } = buildPage(rows, limit);
  return { items: await serializePosts(items as never, userId), meta };
}

async function searchSkills(userId: string, { q, limit }: Q) {
  const hidden = await hiddenUserIds(userId);
  const rows = await UserSkill.find({ skillKey: new RegExp(`^${escapeRegex(q.toLowerCase().replace(/\s+/g, '-'))}`), kind: 'teach', user: { $nin: [...hidden, userId] } })
    .sort({ _id: -1 }).limit(limit).lean();
  const users = await User.find({ _id: { $in: rows.map((r) => r.user) }, status: 'active' }).select('username displayName avatarUrl').lean();
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  // Self-declared skills only: never labeled as verified expertise.
  return { items: rows.filter((r) => uMap.has(String(r.user))).map((r) => ({ skill: r.name, level: r.level, selfDeclared: true, user: userSummary(uMap.get(String(r.user))) })), meta: { nextCursor: null, limit } };
}

router.get('/users', qv, asyncHandler(async (req, res) => { const r = await searchUsers(req.auth!.userId, req.query as never); ok(res, r.items, 200, r.meta); }));
router.get('/communities', qv, asyncHandler(async (req, res) => { const r = await searchCommunities(req.auth!.userId, req.query as never); ok(res, r.items, 200, r.meta); }));
router.get('/posts', qv, asyncHandler(async (req, res) => { const r = await searchPosts(req.auth!.userId, req.query as never); ok(res, r.items, 200, r.meta); }));
router.get('/skills', qv, asyncHandler(async (req, res) => { const r = await searchSkills(req.auth!.userId, req.query as never); ok(res, r.items, 200, r.meta); }));

router.get('/', qv, asyncHandler(async (req, res) => {
  const q = { ...(req.query as unknown as Q), limit: 5, cursor: undefined };
  const uid = req.auth!.userId;
  const [users, communities, posts, skills] = await Promise.all([searchUsers(uid, q), searchCommunities(uid, q), searchPosts(uid, q), searchSkills(uid, q)]);
  ok(res, { users: users.items, communities: communities.items, posts: posts.items, skills: skills.items });
}));

export default router;
