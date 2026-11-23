import { z } from 'zod';
import { localeSchema, objectIdSchema } from './common';

export const slugSchema = z
  .string().trim().toLowerCase().min(3).max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens');

export const COMMUNITY_VISIBILITY = ['public', 'private'] as const;
export const JOIN_POLICIES = ['open', 'approval'] as const;
export const COMMUNITY_ROLES = ['owner', 'admin', 'moderator', 'member'] as const;
export type CommunityRole = (typeof COMMUNITY_ROLES)[number];

export const createCommunitySchema = z.object({
  name: z.string().trim().min(3).max(60),
  slug: slugSchema.optional(),
  description: z.string().trim().max(500).default(''),
  category: z.string().trim().toLowerCase().min(2).max(40),
  tags: z.array(z.string().trim().toLowerCase().min(2).max(30)).max(10).default([]),
  language: localeSchema.default('en'),
  visibility: z.enum(COMMUNITY_VISIBILITY).default('public'),
  joinPolicy: z.enum(JOIN_POLICIES).default('open'),
  rules: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
});
export type CreateCommunityInput = z.infer<typeof createCommunitySchema>;

export const updateCommunitySchema = createCommunitySchema
  .omit({ slug: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

export const communityListQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  category: z.string().trim().toLowerCase().max(40).optional(),
  cursor: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const memberRoleSchema = z.object({ role: z.enum(['admin', 'moderator', 'member']) });
export const communityMemberParamsSchema = z.object({ id: z.string().min(1).max(60), userId: objectIdSchema });
export const communityIdParamSchema = z.object({ id: z.string().min(1).max(60) });
