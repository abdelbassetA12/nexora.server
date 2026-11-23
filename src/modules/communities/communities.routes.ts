import { Router } from 'express';
import {
  communityIdParamSchema, communityListQuerySchema, communityMemberParamsSchema, createCommunitySchema,
  cursorQuerySchema, memberRoleSchema, updateCommunitySchema,
} from '../../shared/index';
import { authenticate, requireVerifiedEmail } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler, ok } from '../../utils/http';
import { listCommunityPosts } from '../posts/posts.service';
import { listEvents } from '../events/events.routes';
import { eventListQuerySchema } from '../../shared/index';
import { findCommunity } from '../common/access';
import * as svc from './communities.service';

const router = Router();
router.use(authenticate);
const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;
const idParam = validate({ params: communityIdParamSchema });
const memberParams = validate({ params: communityMemberParamsSchema });

router.get('/', validate({ query: communityListQuerySchema }), asyncHandler(async (req, res) => {
  const { items, meta } = await svc.listCommunities(uid(req), req.query as never);
  ok(res, items, 200, meta);
}));

router.post('/', requireVerifiedEmail, validate({ body: createCommunitySchema }), asyncHandler(async (req, res) => {
  ok(res, await svc.createCommunity(uid(req), req.body), 201);
}));

router.get('/mine', validate({ query: cursorQuerySchema }), asyncHandler(async (req, res) => {
  const { items, meta } = await svc.listMine(uid(req), req.query as never);
  ok(res, items, 200, meta);
}));

router.get('/:id', idParam, asyncHandler(async (req, res) => ok(res, await svc.getCommunity(uid(req), req.params.id as string))));

router.patch('/:id', idParam, validate({ body: updateCommunitySchema }), asyncHandler(async (req, res) => {
  ok(res, await svc.updateCommunity(uid(req), req.params.id as string, req.body));
}));

router.post('/:id/join', idParam, asyncHandler(async (req, res) => ok(res, await svc.joinCommunity(uid(req), req.params.id as string))));
router.post('/:id/leave', idParam, asyncHandler(async (req, res) => {
  await svc.leaveCommunity(uid(req), req.params.id as string);
  ok(res, { left: true });
}));

router.get('/:id/members', idParam, validate({ query: cursorQuerySchema }), asyncHandler(async (req, res) => {
  const { items, meta } = await svc.listMembers(uid(req), req.params.id as string, req.query as never);
  ok(res, items, 200, meta);
}));

router.get('/:id/posts', idParam, validate({ query: cursorQuerySchema }), asyncHandler(async (req, res) => {
  const { items, meta } = await listCommunityPosts(uid(req), req.params.id as string, req.query as never);
  ok(res, items, 200, meta);
}));

router.get('/:id/events', idParam, validate({ query: eventListQuerySchema }), asyncHandler(async (req, res) => {
  const c = await findCommunity(req.params.id as string);
  const r = await listEvents(uid(req), { ...(req.query as never as { limit: number; cursor?: string; type?: string }), community: String(c._id) });
  ok(res, r.items, 200, { nextCursor: r.nextCursor, limit: Number((req.query as { limit: number }).limit) });
}));

router.get('/:id/join-requests', idParam, validate({ query: cursorQuerySchema }), asyncHandler(async (req, res) => {
  const { items, meta } = await svc.listJoinRequests(uid(req), req.params.id as string, req.query as never);
  ok(res, items, 200, meta);
}));

router.post('/:id/members/:userId/approve', memberParams, asyncHandler(async (req, res) => {
  await svc.decideJoinRequest(uid(req), req.params.id as string, req.params.userId as string, true);
  ok(res, { approved: true });
}));
router.post('/:id/members/:userId/reject', memberParams, asyncHandler(async (req, res) => {
  await svc.decideJoinRequest(uid(req), req.params.id as string, req.params.userId as string, false);
  ok(res, { rejected: true });
}));
router.patch('/:id/members/:userId/role', memberParams, validate({ body: memberRoleSchema }), asyncHandler(async (req, res) => {
  ok(res, await svc.setMemberRole(uid(req), req.params.id as string, req.params.userId as string, req.body.role));
}));
router.post('/:id/members/:userId/ban', memberParams, asyncHandler(async (req, res) => {
  await svc.banMember(uid(req), req.params.id as string, req.params.userId as string);
  ok(res, { banned: true });
}));
router.delete('/:id/members/:userId', memberParams, asyncHandler(async (req, res) => {
  await svc.removeMember(uid(req), req.params.id as string, req.params.userId as string);
  ok(res, { removed: true });
}));

export default router;
