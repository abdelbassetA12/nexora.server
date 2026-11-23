
import { Types } from 'mongoose';
import type {
  ReplaceSkillsInput,
  UpdateProfileInput,
} from '../../shared/index';

import { Block } from '../../database/models/Block';
import { Follow } from '../../database/models/Follow';
import { Interest } from '../../database/models/Interest';
import { User } from '../../database/models/User';
import { UserSkill } from '../../database/models/UserSkill';

import { badRequest, conflict, notFound } from '../../utils/errors';
import { toPrivateUser } from './user.mapper';

type SkillLevel =
  | 'beginner'
  | 'intermediate'
  | 'advanced'
  | 'expert';

const SKILL_LEVELS: readonly SkillLevel[] = [
  'beginner',
  'intermediate',
  'advanced',
  'expert',
];

function normalizeSkillLevel(level: string): SkillLevel {
  if (SKILL_LEVELS.includes(level as SkillLevel)) {
    return level as SkillLevel;
  }

  throw badRequest('Invalid skill level');
}

export const slugify = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export async function updateMe(
  userId: string,
  input: UpdateProfileInput,
) {
  const user = await User.findById(userId);

  if (!user) throw notFound('Account not found');

  if (
    input.username !== undefined &&
    input.username.toLowerCase() !== user.usernameNormalized
  ) {
    const taken = await User.exists({
      usernameNormalized: input.username.toLowerCase(),
      _id: { $ne: user._id },
    });

    if (taken) {
      throw conflict('This username is taken', 'USERNAME_TAKEN');
    }

    user.username = input.username;
    user.usernameNormalized = input.username.toLowerCase();
  }

  if (input.displayName !== undefined) {
    user.displayName = input.displayName;
  }

  if (input.bio !== undefined) {
    user.bio = input.bio;
  }

  if (input.country !== undefined) {
    user.country = input.country as string;
  }

  if (input.languages !== undefined) {
    user.languages = [...new Set(input.languages)];
  }

  if (input.locale !== undefined) {
    user.locale = input.locale;
  }

  if (input.avatarUrl !== undefined) {
    user.avatarUrl = input.avatarUrl as string;
  }

  if (input.goals !== undefined) {
    user.goals = [...new Set(input.goals)];
  }

  if (input.onboarding !== undefined) {
    user.onboarding = input.onboarding;
  }

  if (input.interests !== undefined) {
    const slugs = [
      ...new Set(
        input.interests
          .map(slugify)
          .filter((s) => s.length >= 2),
      ),
    ];

    user.interests = slugs;

    if (slugs.length) {
      // Unknown slugs become custom interests so they are discoverable later.
      await Interest.bulkWrite(
        slugs.map((slug) => ({
          updateOne: {
            filter: { slug },
            update: {
              $setOnInsert: {
                slug,
                name: slug.replace(/-/g, ' '),
                isCustom: true,
                createdBy: user._id,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }
  }

  try {
    await user.save();
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      throw conflict('This username is taken', 'USERNAME_TAKEN');
    }

    throw e;
  }

  return toPrivateUser(user);
}

export async function getMySkills(userId: string) {
  const rows = await UserSkill.find({
    user: new Types.ObjectId(userId),
  })
    .sort({ kind: 1, name: 1 })
    .limit(100)
    .lean();

  return rows.map((r) => ({
    name: r.name,
    kind: r.kind,
    level: r.level,
  }));
}

export async function replaceMySkills(
  userId: string,
  input: ReplaceSkillsInput,
) {
  const userObjectId = new Types.ObjectId(userId);

  const desired = new Map<
    string,
    {
      name: string;
      kind: 'teach' | 'learn';
      level: SkillLevel;
      skillKey: string;
    }
  >();

  for (const s of input.skills) {
    const skillKey = slugify(s.name);

    if (skillKey.length < 2) continue;

    desired.set(`${skillKey}:${s.kind}`, {
      ...s,
      level: normalizeSkillLevel(s.level),
      skillKey,
    });
  }

  const entries = [...desired.values()];

  if (entries.length) {
    await UserSkill.bulkWrite(
      entries.map((e) => ({
        updateOne: {
          filter: {
            user: userObjectId,
            skillKey: e.skillKey,
            kind: e.kind,
          },
          update: {
            $set: {
              name: e.name,
              level: e.level,
            },
            $setOnInsert: {
              selfDeclared: true,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  // Remove skills that are no longer in the submitted set.
  const keep = entries.map((e) => ({
    skillKey: e.skillKey,
    kind: e.kind,
  }));

  await UserSkill.deleteMany({
    user: userObjectId,
    ...(keep.length ? { $nor: keep } : {}),
  });

  return getMySkills(userId);
}

/**
 * Public profile.
 * Only fields the user exposes publicly;
 * email and privacy settings never leave.
 */
export async function getPublicProfile(
  username: string,
  viewerId: string,
) {
  const user = await User.findOne({
    usernameNormalized: username.toLowerCase(),
    status: 'active',
  }).lean();

  if (!user) throw notFound('User not found');

  const blockedEither = await Block.exists({
    $or: [
      {
        blocker: viewerId,
        blocked: user._id,
      },
      {
        blocker: user._id,
        blocked: viewerId,
      },
    ],
  });

  if (blockedEither && String(user._id) !== viewerId) {
    throw notFound('User not found');
  }

  const [isFollowing, followerCount] = await Promise.all([
    Follow.exists({
      follower: viewerId,
      following: user._id,
    }),
    Follow.countDocuments({
      following: user._id,
    }),
  ]);

  const skills = await UserSkill.find({
    user: user._id,
  })
    .sort({ name: 1 })
    .limit(100)
    .lean();

  return {
    id: String(user._id),
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
    bio: user.bio,
    country: user.country ?? null,
    languages: user.languages,
    interests: user.interests,
    memberSince: user.createdAt.toISOString(),
    isSelf: String(user._id) === viewerId,
    isFollowing: Boolean(isFollowing),
    followerCount,

    // Self-declared, not verified expertise.
    skills: skills.map((s) => ({
      name: s.name,
      kind: s.kind,
      level: s.level,
      selfDeclared: true,
    })),
  };
}
/*
import type { ReplaceSkillsInput, UpdateProfileInput } from '../../shared/index';
import { Block } from '../../database/models/Block';
import { Follow } from '../../database/models/Follow';
import { Interest } from '../../database/models/Interest';
import { User } from '../../database/models/User';
import { UserSkill } from '../../database/models/UserSkill';
import { conflict, notFound } from '../../utils/errors';
import { toPrivateUser } from './user.mapper';

export const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export async function updateMe(userId: string, input: UpdateProfileInput) {
  const user = await User.findById(userId);
  if (!user) throw notFound('Account not found');

  if (input.username !== undefined && input.username.toLowerCase() !== user.usernameNormalized) {
    const taken = await User.exists({ usernameNormalized: input.username.toLowerCase(), _id: { $ne: user._id } });
    if (taken) throw conflict('This username is taken', 'USERNAME_TAKEN');
    user.username = input.username;
    user.usernameNormalized = input.username.toLowerCase();
  }
  if (input.displayName !== undefined) user.displayName = input.displayName;
  if (input.bio !== undefined) user.bio = input.bio;
  if (input.country !== undefined) user.country = input.country as string;
  if (input.languages !== undefined) user.languages = [...new Set(input.languages)];
  if (input.locale !== undefined) user.locale = input.locale;
  if (input.avatarUrl !== undefined) user.avatarUrl = input.avatarUrl as string;
  if (input.goals !== undefined) user.goals = [...new Set(input.goals)];
  if (input.onboarding !== undefined) user.onboarding = input.onboarding;

  if (input.interests !== undefined) {
    const slugs = [...new Set(input.interests.map(slugify).filter((s) => s.length >= 2))];
    user.interests = slugs;
    if (slugs.length) {
      // Unknown slugs become custom interests so they are discoverable later.
      await Interest.bulkWrite(
        slugs.map((slug) => ({
          updateOne: {
            filter: { slug },
            update: { $setOnInsert: { slug, name: slug.replace(/-/g, ' '), isCustom: true, createdBy: user._id } },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }
  }

  try {
    await user.save();
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw conflict('This username is taken', 'USERNAME_TAKEN');
    throw e;
  }
  return toPrivateUser(user);
}

export async function getMySkills(userId: string) {
  const rows = await UserSkill.find({ user: userId }).sort({ kind: 1, name: 1 }).limit(100).lean();
  return rows.map((r) => ({ name: r.name, kind: r.kind, level: r.level }));
}

export async function replaceMySkills(userId: string, input: ReplaceSkillsInput) {
  const desired = new Map<string, { name: string; kind: 'teach' | 'learn'; level: string; skillKey: string }>();
  for (const s of input.skills) {
    const skillKey = slugify(s.name);
    if (skillKey.length < 2) continue;
    desired.set(`${skillKey}:${s.kind}`, { ...s, skillKey });
  }
  const entries = [...desired.values()];

  if (entries.length) {
    await UserSkill.bulkWrite(
      entries.map((e) => ({
        updateOne: {
          filter: { user: userId, skillKey: e.skillKey, kind: e.kind },
          update: { $set: { name: e.name, level: e.level }, $setOnInsert: { selfDeclared: true } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
  // Remove skills that are no longer in the submitted set.
  const keep = entries.map((e) => ({ skillKey: e.skillKey, kind: e.kind }));
  await UserSkill.deleteMany({
    user: userId,
    ...(keep.length ? { $nor: keep } : {}),
  });
  return getMySkills(userId);
}

/** Public profile. Only fields the user exposes publicly; email and privacy settings never leave. *//*
export async function getPublicProfile(username: string, viewerId: string) {
  const user = await User.findOne({ usernameNormalized: username.toLowerCase(), status: 'active' }).lean();
  if (!user) throw notFound('User not found');
  const blockedEither = await Block.exists({ $or: [{ blocker: viewerId, blocked: user._id }, { blocker: user._id, blocked: viewerId }] });
  if (blockedEither && String(user._id) !== viewerId) throw notFound('User not found');
  const [isFollowing, followerCount] = await Promise.all([
    Follow.exists({ follower: viewerId, following: user._id }),
    Follow.countDocuments({ following: user._id }),
  ]);
  const skills = await UserSkill.find({ user: user._id }).sort({ name: 1 }).limit(100).lean();
  return {
    id: String(user._id),
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
    bio: user.bio,
    country: user.country ?? null,
    languages: user.languages,
    interests: user.interests,
    memberSince: user.createdAt.toISOString(),
    isSelf: String(user._id) === viewerId,
    isFollowing: Boolean(isFollowing),
    followerCount,
    // Self-declared, not verified expertise.
    skills: skills.map((s) => ({ name: s.name, kind: s.kind, level: s.level, selfDeclared: true })),
  };
}
*/