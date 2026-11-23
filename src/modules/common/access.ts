import { Types } from 'mongoose';
import type { CommunityRole } from '../../shared/index';
import { Block } from '../../database/models/Block';
import { Community } from '../../database/models/Community';
import { CommunityMembership } from '../../database/models/CommunityMembership';
import { forbidden, notFound } from '../../utils/errors';

export const ROLE_RANK: Record<CommunityRole, number> = { member: 1, moderator: 2, admin: 3, owner: 4 };

export const isObjectId = (v: string) => Types.ObjectId.isValid(v) && /^[a-f\d]{24}$/i.test(v);

export async function findCommunity(idOrSlug: string) {
  const community = await Community.findOne(
    isObjectId(idOrSlug) ? { _id: idOrSlug } : { slug: idOrSlug.toLowerCase() },
  );
  if (!community || community.status !== 'active') throw notFound('Community not found');
  return community;
}

export const getMembership = (communityId: unknown, userId: string) =>
  CommunityMembership.findOne({ community: communityId, user: userId });

export async function activeRole(communityId: unknown, userId: string): Promise<CommunityRole | null> {
  const m = await getMembership(communityId, userId);
  return m && m.status === 'active' ? (m.role as CommunityRole) : null;
}

/** Throws unless the user holds at least `min` in the community. */
export async function requireCommunityRole(communityId: unknown, userId: string, min: CommunityRole) {
  const role = await activeRole(communityId, userId);
  if (!role || ROLE_RANK[role] < ROLE_RANK[min]) throw forbidden('You do not have permission in this community');
  return role;
}

/** Users the viewer must not see or interact with: ones they blocked and ones that blocked them. */
export async function hiddenUserIds(userId: string): Promise<Types.ObjectId[]> {
  const rows = await Block.find({ $or: [{ blocker: userId }, { blocked: userId }] }).select('blocker blocked').lean();
  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(String(r.blocker));
    ids.add(String(r.blocked));
  }
  ids.delete(userId);
  return [...ids].map((i) => new Types.ObjectId(i));
}

export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  return Boolean(await Block.exists({ $or: [{ blocker: a, blocked: b }, { blocker: b, blocked: a }] }));
}

export async function myActiveCommunityIds(userId: string): Promise<Types.ObjectId[]> {
  const rows = await CommunityMembership.find({ user: userId, status: 'active' }).select('community').lean();
  return rows.map((r) => r.community as Types.ObjectId);
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
