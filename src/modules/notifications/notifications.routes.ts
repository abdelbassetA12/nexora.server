import { Router } from 'express';
import { cursorQuerySchema, idParamSchema } from '../../shared/index';
import { Notification } from '../../database/models/Notification';
import { User } from '../../database/models/User';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { notFound } from '../../utils/errors';
import { asyncHandler, ok } from '../../utils/http';
import { buildPage } from '../../utils/pagination';
import { userSummary } from '../common/serializers';

const router = Router();
router.use(authenticate);

router.get('/', validate({ query: cursorQuerySchema }), asyncHandler(async (req, res) => {
  const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
  const filter: Record<string, unknown> = { recipient: req.auth!.userId };
  if (cursor) filter._id = { $lt: cursor };
  const rows = await Notification.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const { items, meta } = buildPage(rows, limit);
  const actors = await User.find({ _id: { $in: items.map((i) => i.actor).filter(Boolean) } }).select('username displayName avatarUrl').lean();
  const aMap = new Map(actors.map((a) => [String(a._id), a]));
  ok(res, items.map((n) => ({
    id: String(n._id), type: n.type, resourceType: n.resourceType, resourceId: String(n.resourceId),
    actor: n.actor ? userSummary(aMap.get(String(n.actor))) : null, read: !!n.readAt, createdAt: n.createdAt.toISOString(),
  })), 200, meta);
}));

router.get('/unread-count', asyncHandler(async (req, res) => {
  ok(res, { count: await Notification.countDocuments({ recipient: req.auth!.userId, readAt: null }) });
}));

router.post('/read-all', asyncHandler(async (req, res) => {
  const r = await Notification.updateMany({ recipient: req.auth!.userId, readAt: null }, { readAt: new Date() });
  ok(res, { updated: r.modifiedCount });
}));

router.post('/:id/read', validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  // Scoped to the recipient: users cannot touch each other's notifications.
  const n = await Notification.findOneAndUpdate({ _id: req.params.id, recipient: req.auth!.userId }, { readAt: new Date() });
  if (!n) throw notFound('Notification not found');
  ok(res, { read: true });
}));

export default router;
