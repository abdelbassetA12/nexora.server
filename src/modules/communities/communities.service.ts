import crypto from 'node:crypto';
import type { CreateCommunityInput } from '../../shared/index';
import { Community } from '../../database/models/Community';
import { CommunityMembership } from '../../database/models/CommunityMembership';
import { Post } from '../../database/models/Post';
import { User } from '../../database/models/User';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { buildPage } from '../../utils/pagination';
import {
  ROLE_RANK, activeRole, findCommunity, getMembership, requireCommunityRole,
} from '../common/access';
import { notify } from '../notifications/notify';
import { userSummary } from '../common/serializers';
import type { CommunityRole } from '../../shared/index';

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

type CommunityDoc = Awaited<ReturnType<typeof findCommunity>>;

export function serializeCommunity(c: CommunityDoc, membership?: { role: string; status: string } | null, summaryOnly = false) {
  return {
    id: String(c._id),
    slug: c.slug,
    name: c.name,
    description: c.description,
    category: c.category,
    tags: c.tags,
    language: c.language,
    visibility: c.visibility,
    joinPolicy: c.joinPolicy,
    memberCount: c.memberCount,
    postCount: c.postCount,
    iconUrl: c.iconUrl ?? null,
    coverUrl: c.coverUrl ?? null,
    // Rules and details are hidden from non-members of private communities.
    rules: summaryOnly ? [] : c.rules,
    createdAt: c.createdAt.toISOString(),
    myMembership: membership ? { role: membership.role, status: membership.status } : null,
  };
}

export async function createCommunity(userId: string, input: CreateCommunityInput) {
  let slug = input.slug ?? slugify(input.name);
  if (slug.length < 3) slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`.slice(0, 40);
  if (!input.slug && (await Community.exists({ slug }))) slug = `${slug.slice(0, 34)}-${crypto.randomBytes(2).toString('hex')}`;

  let community;
  try {
    community = await Community.create({ ...input, slug, owner: userId, memberCount: 1 });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw conflict('This community address is taken', 'SLUG_TAKEN');
    throw e;
  }
  try {
    await CommunityMembership.create({ community: community._id, user: userId, role: 'owner', status: 'active' });
  } catch (e) {
    await Community.deleteOne({ _id: community._id }); // no half-created community without an owner
    throw e;
  }
  return serializeCommunity(community, { role: 'owner', status: 'active' });
}

export async function listCommunities(userId: string, q: { q?: string; category?: string; cursor?: string; limit: number }) {
  const filter: Record<string, unknown> = { visibility: 'public', status: 'active' };
  if (q.category) filter.category = q.category;
  if (q.q) filter.$text = { $search: q.q };
  if (q.cursor) filter._id = { $lt: q.cursor };
  const rows = await Community.find(filter).sort({ _id: -1 }).limit(q.limit + 1);
  const { items, meta } = buildPage(rows, q.limit);
  const memberships = await CommunityMembership.find({ user: userId, community: { $in: items.map((i) => i._id) } }).lean();
  const byCommunity = new Map(memberships.map((m) => [String(m.community), m]));
  return { items: items.map((c) => serializeCommunity(c, byCommunity.get(String(c._id)))), meta };
}

export async function getCommunity(userId: string, idOrSlug: string) {
  const c = await findCommunity(idOrSlug);
  const m = await getMembership(c._id, userId);
  const isMember = m?.status === 'active';
  if (m?.status === 'banned') throw notFound('Community not found');
  // Private communities expose only a summary to non-members.
  return serializeCommunity(c, m, c.visibility === 'private' && !isMember);
}

export async function updateCommunity(userId: string, idOrSlug: string, input: Record<string, unknown>) {
  const c = await findCommunity(idOrSlug);
  await requireCommunityRole(c._id, userId, 'admin');
  const visibilityChanged = input.visibility !== undefined && input.visibility !== c.visibility;
  c.set(input);
  await c.save();
  if (visibilityChanged) {
    // Keep denormalized post visibility consistent with the community.
    await Post.updateMany({ community: c._id }, { visibility: c.visibility === 'private' ? 'community' : 'public' });
  }
  return serializeCommunity(c, await getMembership(c._id, userId));
}

export async function joinCommunity(userId: string, idOrSlug: string) {
  const c = await findCommunity(idOrSlug);
  const existing = await getMembership(c._id, userId);
  if (existing?.status === 'banned') throw forbidden('You cannot join this community', 'BANNED');
  if (existing) return { status: existing.status, role: existing.role };

  const status = c.visibility === 'private' || c.joinPolicy === 'approval' ? 'pending' : 'active';
  try {
    await CommunityMembership.create({ community: c._id, user: userId, role: 'member', status });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      const again = await getMembership(c._id, userId); // concurrent duplicate request: idempotent
      return { status: again?.status ?? status, role: again?.role ?? 'member' };
    }
    throw e;
  }
  if (status === 'active') await Community.updateOne({ _id: c._id }, { $inc: { memberCount: 1 } });
  else await notify({ recipient: c.owner, actor: userId, type: 'join_request', resourceType: 'community', resourceId: c._id });
  return { status, role: 'member' };
}

export async function leaveCommunity(userId: string, idOrSlug: string) {
  const c = await findCommunity(idOrSlug);
  const m = await getMembership(c._id, userId);
  if (!m || m.status === 'banned') throw notFound('You are not a member of this community');
  if (m.role === 'owner') throw conflict('Owners must transfer ownership before leaving', 'OWNER_CANNOT_LEAVE');
  const wasActive = m.status === 'active';
  await m.deleteOne();
  if (wasActive) await Community.updateOne({ _id: c._id }, { $inc: { memberCount: -1 } });
}

export async function listMembers(userId: string, idOrSlug: string, q: { cursor?: string; limit: number }) {
  const c = await findCommunity(idOrSlug);
  if (c.visibility === 'private' && !(await activeRole(c._id, userId))) throw forbidden('Members only');
  const filter: Record<string, unknown> = { community: c._id, status: 'active' };
  if (q.cursor) filter._id = { $lt: q.cursor };
  const rows = await CommunityMembership.find(filter).sort({ _id: -1 }).limit(q.limit + 1).lean();
  const { items, meta } = buildPage(rows, q.limit);
  const users = await User.find({ _id: { $in: items.map((i) => i.user) }, status: 'active' }).select('username displayName avatarUrl').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return {
    items: items.map((m) => ({ role: m.role, joinedAt: m.createdAt.toISOString(), user: userSummary(byId.get(String(m.user))) })).filter((i) => i.user),
    meta,
  };
}

export async function listJoinRequests(userId: string, idOrSlug: string, q: { cursor?: string; limit: number }) {
  const c = await findCommunity(idOrSlug);
  await requireCommunityRole(c._id, userId, 'moderator');
  const filter: Record<string, unknown> = { community: c._id, status: 'pending' };
  if (q.cursor) filter._id = { $lt: q.cursor };
  const rows = await CommunityMembership.find(filter).sort({ _id: -1 }).limit(q.limit + 1).lean();
  const { items, meta } = buildPage(rows, q.limit);
  const users = await User.find({ _id: { $in: items.map((i) => i.user) } }).select('username displayName avatarUrl').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return { items: items.map((m) => ({ requestedAt: m.createdAt.toISOString(), user: userSummary(byId.get(String(m.user))) })), meta };
}

export async function decideJoinRequest(actorId: string, idOrSlug: string, targetId: string, approve: boolean) {
  const c = await findCommunity(idOrSlug);
  await requireCommunityRole(c._id, actorId, 'moderator');
  if (approve) {
    const m = await CommunityMembership.findOneAndUpdate({ community: c._id, user: targetId, status: 'pending' }, { status: 'active' });
    if (!m) throw notFound('No pending request for this user');
    await Community.updateOne({ _id: c._id }, { $inc: { memberCount: 1 } });
    await notify({ recipient: targetId, actor: actorId, type: 'membership_approved', resourceType: 'community', resourceId: c._id });
  } else {
    const res = await CommunityMembership.deleteOne({ community: c._id, user: targetId, status: 'pending' });
    if (!res.deletedCount) throw notFound('No pending request for this user');
  }
}

export async function setMemberRole(actorId: string, idOrSlug: string, targetId: string, role: 'admin' | 'moderator' | 'member') {
  const c = await findCommunity(idOrSlug);
  await requireCommunityRole(c._id, actorId, 'owner'); // only owners manage roles
  if (actorId === targetId) throw badRequest('You cannot change your own role');
  const m = await CommunityMembership.findOneAndUpdate({ community: c._id, user: targetId, status: 'active', role: { $ne: 'owner' } }, { role }, { new: true });
  if (!m) throw notFound('Member not found');
  return { role: m.role };
}

async function assertCanActOn(actorId: string, communityId: unknown, targetId: string, min: CommunityRole) {
  if (actorId === targetId) throw badRequest('You cannot do this to yourself');
  const actorRole = await requireCommunityRole(communityId, actorId, min);
  const target = await getMembership(communityId, targetId);
  if (!target) throw notFound('Member not found');
  if (ROLE_RANK[target.role as CommunityRole] >= ROLE_RANK[actorRole]) throw forbidden('You cannot act on a member with an equal or higher role');
  return target;
}

export async function removeMember(actorId: string, idOrSlug: string, targetId: string) {
  const c = await findCommunity(idOrSlug);
  const target = await assertCanActOn(actorId, c._id, targetId, 'moderator');
  const wasActive = target.status === 'active';
  await target.deleteOne();
  if (wasActive) await Community.updateOne({ _id: c._id }, { $inc: { memberCount: -1 } });
}

export async function banMember(actorId: string, idOrSlug: string, targetId: string) {
  const c = await findCommunity(idOrSlug);
  const target = await assertCanActOn(actorId, c._id, targetId, 'admin');
  const wasActive = target.status === 'active';
  target.status = 'banned';
  target.role = 'member';
  await target.save();
  if (wasActive) await Community.updateOne({ _id: c._id }, { $inc: { memberCount: -1 } });
}


/** Communities the user is an active member of (including private ones). */
export async function listMine(userId: string, q: { cursor?: string; limit: number }) {
  const filter: Record<string, unknown> = { user: userId, status: 'active' };
  if (q.cursor) filter._id = { $lt: q.cursor };
  const rows = await CommunityMembership.find(filter).sort({ _id: -1 }).limit(q.limit + 1).lean();
  const { items, meta } = buildPage(rows, q.limit);
  const communities = await Community.find({ _id: { $in: items.map((i) => i.community) }, status: 'active' });
  const byId = new Map(communities.map((c) => [String(c._id), c]));
  return {
    items: items.flatMap((m) => {
      const c = byId.get(String(m.community));
      return c ? [serializeCommunity(c, m)] : [];
    }),
    meta,
  };
}
