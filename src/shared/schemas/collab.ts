import { z } from 'zod';
import { localeSchema, objectIdSchema } from './common';

const page = { cursor: objectIdSchema.optional(), limit: z.coerce.number().int().min(1).max(30).default(20) };
const iso = z.string().datetime({ offset: true });

// ---------- Skill exchange ----------
export const SKILL_FORMATS = ['text', 'audio', 'video', 'project'] as const;
const skillName = z.string().trim().min(2).max(60);
export const createSkillOfferSchema = z.object({
  title: z.string().trim().min(5).max(100),
  description: z.string().trim().min(1).max(1000),
  skill: skillName,
  format: z.enum(SKILL_FORMATS).default('text'),
  language: localeSchema.default('en'),
  availability: z.string().trim().max(200).default(''),
});
export const createSkillRequestSchema = createSkillOfferSchema
  .extend({ audience: z.enum(['open', 'direct', 'community']).default('open'), targetUser: objectIdSchema.optional(), community: objectIdSchema.optional() })
  .superRefine((v, ctx) => {
    if (v.audience === 'direct' && !v.targetUser) ctx.addIssue({ code: 'custom', path: ['targetUser'], message: 'Choose who this request is for' });
    if (v.audience === 'community' && !v.community) ctx.addIssue({ code: 'custom', path: ['community'], message: 'Choose a community' });
  });
export const skillListQuerySchema = z.object({ skill: z.string().trim().max(60).optional(), language: localeSchema.optional(), format: z.enum(SKILL_FORMATS).optional(), ...page });
export const createExchangeSchema = z
  .object({ offerId: objectIdSchema.optional(), requestId: objectIdSchema.optional(), message: z.string().trim().min(1).max(1000), offeredInReturn: z.string().trim().max(200).optional() })
  .refine((v) => Boolean(v.offerId) !== Boolean(v.requestId), 'Provide exactly one of offerId or requestId');
export const scheduleExchangeSchema = z.object({ scheduledAt: iso });
export const exchangeFeedbackSchema = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional() });
export const exchangeListQuerySchema = z.object({ status: z.enum(['proposed', 'accepted', 'declined', 'scheduled', 'completed', 'cancelled']).optional(), ...page });

// ---------- Projects ----------
export const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'done'] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
const list = (max: number, len = 100) => z.array(z.string().trim().min(1).max(len)).max(max).default([]);
export const createProjectSchema = z.object({
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().min(1).max(3000),
  category: z.string().trim().toLowerCase().min(2).max(40),
  skills: z.array(z.string().trim().toLowerCase().min(2).max(40)).max(15).default([]),
  goals: list(10), deliverables: list(15),
  visibility: z.enum(['public', 'private']).default('public'),
  deadline: iso.optional(),
});
export const updateProjectSchema = createProjectSchema.partial()
  .extend({ status: z.enum(['planning', 'active', 'completed', 'archived']).optional() })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const projectListQuerySchema = z.object({ skill: z.string().trim().toLowerCase().max(40).optional(), ...page });
export const joinRequestSchema = z.object({ message: z.string().trim().max(500).default('') });
export const createTaskSchema = z.object({
  title: z.string().trim().min(2).max(150), description: z.string().trim().max(2000).default(''),
  assignee: objectIdSchema.optional(), priority: z.enum(TASK_PRIORITIES).default('medium'), dueDate: iso.optional(),
});
export const updateTaskSchema = z.object({
  title: z.string().trim().min(2).max(150), description: z.string().trim().max(2000), assignee: objectIdSchema.nullable(),
  priority: z.enum(TASK_PRIORITIES), dueDate: iso.nullable(), status: z.enum(TASK_STATUSES),
}).partial().refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const taskListQuerySchema = z.object({ status: z.enum(TASK_STATUSES).optional(), ...page });
export const taskCommentSchema = z.object({ body: z.string().trim().min(1).max(2000) });
export const projectMemberParamsSchema = z.object({ id: objectIdSchema, userId: objectIdSchema });

// ---------- Events ----------
export const EVENT_TYPES = ['workshop', 'language_practice', 'discussion', 'skill_exchange', 'project_review', 'study_session', 'expert_talk', 'challenge'] as const;
const timeZone = z.string().min(3).max(64).refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Unknown time zone');
export const createEventSchema = z.object({
  title: z.string().trim().min(3).max(120), description: z.string().trim().max(3000).default(''),
  type: z.enum(EVENT_TYPES).default('discussion'), community: objectIdSchema.optional(),
  startsAt: iso, // must carry an explicit UTC offset: the instant is never guessed
  timeZone, durationMinutes: z.number().int().min(15).max(720).default(60),
  capacity: z.number().int().min(1).max(10000).optional(), resourceLinks: z.array(z.string().url().max(500)).max(10).default([]),
});
export const updateEventSchema = createEventSchema.omit({ community: true }).partial()
  .extend({ status: z.literal('cancelled').optional() })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const eventListQuerySchema = z.object({
  type: z.enum(EVENT_TYPES).optional(), community: objectIdSchema.optional(),
  cursor: z.string().regex(/^\d+:[a-f\d]{24}$/i).optional(), limit: z.coerce.number().int().min(1).max(30).default(20),
});

// ---------- Goals ----------
export const GOAL_CATEGORIES = ['learning', 'career', 'language', 'project', 'collaboration', 'other'] as const;
export const createGoalSchema = z.object({
  title: z.string().trim().min(3).max(120), description: z.string().trim().max(1000).default(''),
  category: z.enum(GOAL_CATEGORIES).default('other'), targetDate: iso.optional(),
  milestones: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  project: objectIdSchema.optional(), community: objectIdSchema.optional(),
});
export const updateGoalSchema = z.object({
  title: z.string().trim().min(3).max(120), description: z.string().trim().max(1000), category: z.enum(GOAL_CATEGORIES),
  targetDate: iso.nullable(), status: z.enum(['active', 'completed', 'archived']),
}).partial().refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const createMilestoneSchema = z.object({ title: z.string().trim().min(1).max(120), dueDate: iso.optional() });
export const updateMilestoneSchema = z.object({ title: z.string().trim().min(1).max(120), dueDate: iso.nullable(), completed: z.boolean() })
  .partial().refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const goalListQuerySchema = z.object({ status: z.enum(['active', 'completed', 'archived']).optional(), ...page });
