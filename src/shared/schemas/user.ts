import { z } from 'zod';
import { localeSchema, objectIdSchema } from './common';
import { usernameSchema } from './auth';

export const GOAL_INTENTS = [
  'complete_project',
  'improve_language',
  'find_collaborators',
  'develop_skill',
  'build_portfolio',
  'find_mentor',
  'career_growth',
  'learn_trading',
] as const;
export type GoalIntent = (typeof GOAL_INTENTS)[number];

export const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'] as const;
export const skillLevelSchema = z.enum(SKILL_LEVELS);

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60),
    username: usernameSchema,
    bio: z.string().trim().max(500),
    country: z.string().trim().length(2).toUpperCase().nullable(),
    languages: z.array(z.string().trim().min(2).max(8)).max(10),
    locale: localeSchema,
    avatarUrl: z.string().url().max(500).nullable(),
    interests: z.array(z.string().trim().toLowerCase().min(2).max(40)).max(30),
    goals: z.array(z.enum(GOAL_INTENTS)).max(GOAL_INTENTS.length),
    onboarding: z.object({
      step: z.number().int().min(0).max(6),
      completed: z.boolean(),
    }),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const userSkillEntrySchema = z.object({
  name: z.string().trim().min(2).max(60),
  kind: z.enum(['teach', 'learn']),
  level: skillLevelSchema.default('beginner'),
});
export const replaceSkillsSchema = z.object({
  skills: z.array(userSkillEntrySchema).max(60),
});
export type ReplaceSkillsInput = z.infer<typeof replaceSkillsSchema>;

export const usernameParamSchema = z.object({ username: usernameSchema });
export const idParamSchema = z.object({ id: objectIdSchema });

export const createInterestSchema = z.object({
  name: z.string().trim().min(2).max(40),
});
