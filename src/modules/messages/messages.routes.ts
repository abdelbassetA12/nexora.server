import { Router } from 'express';
import {
  conversationListQuerySchema, createConversationSchema, editMessageSchema, idParamSchema, markReadSchema,
  messageListQuerySchema, muteSchema, sendMessageSchema,
} from '../../shared/index';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler, ok } from '../../utils/http';
import * as svc from './messages.service';

const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;
const idp = validate({ params: idParamSchema });

export const conversationsRouter = Router();
conversationsRouter.use(authenticate);

conversationsRouter.get('/', validate({ query: conversationListQuerySchema }), asyncHandler(async (req, res) => {
  const { items, nextCursor } = await svc.listConversations(uid(req), req.query as never);
  ok(res, items, 200, { nextCursor, limit: Number((req.query as { limit: number }).limit) });
}));
conversationsRouter.post('/', validate({ body: createConversationSchema }), asyncHandler(async (req, res) => ok(res, await svc.createConversation(uid(req), req.body), 201)));
conversationsRouter.get('/:id', idp, asyncHandler(async (req, res) => ok(res, await svc.getConversation(uid(req), req.params.id as string))));

conversationsRouter.get('/:id/messages', idp, validate({ query: messageListQuerySchema }), asyncHandler(async (req, res) => {
  const { items, meta } = await svc.listMessages(uid(req), req.params.id as string, req.query as never);
  ok(res, items, 200, meta);
}));
conversationsRouter.post('/:id/messages', idp, validate({ body: sendMessageSchema }), asyncHandler(async (req, res) => {
  const { message, created } = await svc.sendMessage(uid(req), req.params.id as string, req.body);
  ok(res, message, created ? 201 : 200);
}));
conversationsRouter.post('/:id/read', idp, validate({ body: markReadSchema }), asyncHandler(async (req, res) => ok(res, await svc.markRead(uid(req), req.params.id as string, req.body.messageId))));
conversationsRouter.post('/:id/mute', idp, validate({ body: muteSchema }), asyncHandler(async (req, res) => ok(res, await svc.setMuted(uid(req), req.params.id as string, req.body.muted))));
conversationsRouter.post('/:id/leave', idp, asyncHandler(async (req, res) => {
  await svc.leaveConversation(uid(req), req.params.id as string);
  ok(res, { left: true });
}));

export const messagesRouter = Router();
messagesRouter.use(authenticate);
messagesRouter.patch('/:id', idp, validate({ body: editMessageSchema }), asyncHandler(async (req, res) => ok(res, await svc.editMessage(uid(req), req.params.id as string, req.body.body))));
messagesRouter.delete('/:id', idp, asyncHandler(async (req, res) => {
  await svc.deleteMessage(uid(req), req.params.id as string);
  ok(res, { deleted: true });
}));
