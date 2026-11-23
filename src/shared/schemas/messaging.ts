import { z } from 'zod';
import { objectIdSchema } from './common';

export const clientMsgIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid client message id');

export const createConversationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('direct'), userId: objectIdSchema }),
  z.object({
    type: z.literal('group'),
    title: z.string().trim().min(1).max(60),
    memberIds: z.array(objectIdSchema).min(1).max(49),
  }),
]);
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  clientMsgId: clientMsgIdSchema,
  replyTo: objectIdSchema.optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.object({ body: z.string().trim().min(1).max(4000) });
export const markReadSchema = z.object({ messageId: objectIdSchema.optional() });
export const muteSchema = z.object({ muted: z.boolean() });

export const conversationListQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(), // lastMessageAt cursor (epoch ms)
  limit: z.coerce.number().int().min(1).max(30).default(20),
});

export const messageListQuerySchema = z.object({
  cursor: objectIdSchema.optional(),
  after: objectIdSchema.optional(), // sync: messages newer than this id (ascending)
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

// Socket payloads
export const socketSendSchema = sendMessageSchema.extend({ conversationId: objectIdSchema });
export const socketConversationSchema = z.object({ conversationId: objectIdSchema });
