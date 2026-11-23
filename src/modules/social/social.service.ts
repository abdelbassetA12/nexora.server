import { Block } from '../../database/models/Block';
import { Follow } from '../../database/models/Follow';
import { User } from '../../database/models/User';
import { badRequest, forbidden, notFound } from '../../utils/errors';
import { isBlockedBetween } from '../common/access';
import { notify } from '../notifications/notify';

async function requireTarget(actorId: string, targetId: string) {
  if (actorId === targetId) throw badRequest('You cannot do this to yourself');
  const target = await User.findOne({ _id: targetId, status: 'active' }).select('_id').lean();
  if (!target) throw notFound('User not found');
}

export async function follow(actorId: string, targetId: string) {
  await requireTarget(actorId, targetId);
  if (await isBlockedBetween(actorId, targetId)) throw forbidden('You cannot follow this user');
  const res = await Follow.updateOne({ follower: actorId, following: targetId }, { $setOnInsert: { follower: actorId, following: targetId } }, { upsert: true });
  if (res.upsertedCount) await notify({ recipient: targetId, actor: actorId, type: 'follow', resourceType: 'user', resourceId: actorId });
  return { following: true };
}

export async function unfollow(actorId: string, targetId: string) {
  await Follow.deleteOne({ follower: actorId, following: targetId });
  return { following: false };
}

export async function block(actorId: string, targetId: string) {
  await requireTarget(actorId, targetId);
  await Block.updateOne({ blocker: actorId, blocked: targetId }, { $setOnInsert: { blocker: actorId, blocked: targetId } }, { upsert: true });
  // Blocking severs follows in both directions.
  await Follow.deleteMany({ $or: [{ follower: actorId, following: targetId }, { follower: targetId, following: actorId }] });
  return { blocked: true };
}

export async function unblock(actorId: string, targetId: string) {
  await Block.deleteOne({ blocker: actorId, blocked: targetId });
  return { blocked: false };
}
