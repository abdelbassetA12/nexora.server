
import { Router } from 'express';
import { idParamSchema } from '../../shared/index';
import {
  AchievementDefinition,
  UserAchievement,
} from '../../database/models/Achievement';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler, ok } from '../../utils/http';
import { logger } from '../../utils/logger';

// Achievements come only from verifiable application events.
export const CATALOG = [
  {
    key: 'first_goal_completed',
    name: { en: 'Goal getter', ar: 'محقق الأهداف' },
    description: {
      en: 'Completed your first goal.',
      ar: 'أكملت هدفك الأول.',
    },
  },
  {
    key: 'first_accepted_answer',
    name: { en: 'Helpful answer', ar: 'إجابة مفيدة' },
    description: {
      en: 'Your answer was accepted by the asker.',
      ar: 'اعتمد صاحب السؤال إجابتك.',
    },
  },
  {
    key: 'first_exchange_completed',
    name: { en: 'Skill swapper', ar: 'مبادل المهارات' },
    description: {
      en: 'Completed a skill exchange confirmed by both sides.',
      ar: 'أكملت تبادل مهارة أكّده الطرفان.',
    },
  },
  {
    key: 'first_team_task_done',
    name: { en: 'Team player', ar: 'لاعب فريق' },
    description: {
      en: 'Finished a task in a project with other members.',
      ar: 'أنهيت مهمة في مشروع مع آخرين.',
    },
  },
] as const;

export async function ensureAchievementCatalog(): Promise<void> {
  await AchievementDefinition.bulkWrite(
    CATALOG.map((c) => ({
      updateOne: {
        filter: { key: c.key },
        update: {
          $set: {
            name: c.name,
            description: c.description,
          },
        },
        upsert: true,
      },
    })),
  );
}

/**
 * Idempotent. Never throws:
 * an achievement failure must not break the action that earned it.
 */
export async function award(
  userId: unknown,
  key: (typeof CATALOG)[number]['key'],
  source: 'goal' | 'answer' | 'exchange' | 'task',
  sourceId: unknown,
): Promise<void> {
  try {
    await UserAchievement.updateOne(
      { user: userId, key },
      {
        $setOnInsert: {
          user: userId,
          key,
          source,
          sourceId,
        },
      },
      { upsert: true },
    );
  } catch (err) {
    logger.error({ err }, 'Failed to award achievement');
  }
}

const earned = async (userId: string) =>
  (
    await UserAchievement.find({ user: userId }).lean()
  ).map((a) => ({
    key: a.key,
    earnedAt: a.earnedAt?.toISOString() ?? null,
  }));

export const achievementsRouter = Router();

achievementsRouter.use(authenticate);

achievementsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const mine = new Map(
      (await earned(req.auth!.userId)).map((e) => [
        e.key,
        e.earnedAt,
      ]),
    );

    ok(
      res,
      CATALOG.map((c) => ({
        ...c,
        earned: mine.has(c.key),
        earnedAt: mine.get(c.key) ?? null,
      })),
    );
  }),
);

export const userAchievementsHandler = [
  authenticate,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const list = await earned(req.params.id as string);

    ok(
      res,
      list.map((e) => ({
        ...CATALOG.find((c) => c.key === e.key),
        earnedAt: e.earnedAt,
      })),
    );
  }),
] as const;
/*
import { Router } from 'express';
import { idParamSchema } from '../../shared/index';
import { AchievementDefinition, UserAchievement } from '../../database/models/Achievement';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler, ok } from '../../utils/http';
import { logger } from '../../utils/logger';

// Achievements come only from verifiable application events (see award() call sites), each earned once.
export const CATALOG = [
  { key: 'first_goal_completed', name: { en: 'Goal getter', ar: 'محقق الأهداف' }, description: { en: 'Completed your first goal.', ar: 'أكملت هدفك الأول.' } },
  { key: 'first_accepted_answer', name: { en: 'Helpful answer', ar: 'إجابة مفيدة' }, description: { en: 'Your answer was accepted by the asker.', ar: 'اعتمد صاحب السؤال إجابتك.' } },
  { key: 'first_exchange_completed', name: { en: 'Skill swapper', ar: 'مبادل المهارات' }, description: { en: 'Completed a skill exchange confirmed by both sides.', ar: 'أكملت تبادل مهارة أكّده الطرفان.' } },
  { key: 'first_team_task_done', name: { en: 'Team player', ar: 'لاعب فريق' }, description: { en: 'Finished a task in a project with other members.', ar: 'أنهيت مهمة في مشروع مع آخرين.' } },
] as const;

export async function ensureAchievementCatalog() {
  await AchievementDefinition.bulkWrite(CATALOG.map((c) => ({ updateOne: { filter: { key: c.key }, update: { $set: { name: c.name, description: c.description } }, upsert: true } })));
}

/** Idempotent. Never throws: an achievement failure must not break the action that earned it. *//*
export async function award(userId: unknown, key: (typeof CATALOG)[number]['key'], source: 'goal' | 'answer' | 'exchange' | 'task', sourceId: unknown) {
  try {
    await UserAchievement.updateOne({ user: userId, key }, { $setOnInsert: { user: userId, key, source, sourceId } }, { upsert: true });
  } catch (err) { logger.error({ err }, 'Failed to award achievement'); }
}

const earned = async (userId: string) => (await UserAchievement.find({ user: userId }).lean()).map((a) => ({ key: a.key, earnedAt: a.earnedAt.toISOString() }));

export const achievementsRouter = Router();
achievementsRouter.use(authenticate);
achievementsRouter.get('/', asyncHandler(async (req, res) => {
  const mine = new Map((await earned(req.auth!.userId)).map((e) => [e.key, e.earnedAt]));
  ok(res, CATALOG.map((c) => ({ ...c, earned: mine.has(c.key), earnedAt: mine.get(c.key) ?? null })));
}));
export const userAchievementsHandler = [authenticate, validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const list = await earned(req.params.id as string);
  ok(res, list.map((e) => ({ ...CATALOG.find((c) => c.key === e.key), earnedAt: e.earnedAt })));
})] as const;
*/