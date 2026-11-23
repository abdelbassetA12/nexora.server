import type { Types } from 'mongoose';

interface UserLike { _id: unknown; username: string; displayName: string; avatarUrl?: string | null }

export const userSummary = (u: UserLike | null | undefined) =>
  u ? { id: String(u._id), username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl ?? null } : null;

export type Id = Types.ObjectId | string;
