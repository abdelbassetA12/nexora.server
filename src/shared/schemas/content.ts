import { z } from 'zod';
import { objectIdSchema } from './common';

export const POST_TYPES = [
  'discussion', 'question', 'resource', 'project_update', 'case_study', 'achievement', 'skill_request', 'event_announcement',
] as const;
export type PostType = (typeof POST_TYPES)[number];

const tagsSchema = z.array(z.string().trim().toLowerCase().min(2).max(30)).max(8).default([]);

export const createPostSchema = z
  .object({
    type: z.enum(POST_TYPES).default('discussion'),
    title: z.string().trim().min(5).max(150).optional(),
    body: z.string().trim().min(1).max(5000),
    community: objectIdSchema.optional(),
    tags: tagsSchema,
    linkUrl: z.string().url().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'question' && !v.title) ctx.addIssue({ code: 'custom', path: ['title'], message: 'A question needs a title' });
  });
export type CreatePostInput = z.infer<typeof createPostSchema>;

export const updatePostSchema = z
  .object({ title: z.string().trim().min(5).max(150), body: z.string().trim().min(1).max(5000), tags: tagsSchema })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

export const REACTION_TYPES = ['like', 'insightful', 'helpful'] as const;
export const reactionSchema = z.object({ type: z.enum(REACTION_TYPES).default('like') });

export const createCommentSchema = z.object({ body: z.string().trim().min(1).max(2000) });
export const acceptAnswerSchema = z.object({ commentId: objectIdSchema });

export const feedQuerySchema = z.object({
  cursor: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(30).default(20),
});

export const REPORT_TARGETS = ['post', 'comment', 'user', 'community'] as const;
export const REPORT_REASONS = ['spam', 'harassment', 'hate', 'misinformation', 'inappropriate', 'impersonation', 'other'] as const;
export const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: objectIdSchema,
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000).optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(80),
  cursor: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(30).default(15),
});
