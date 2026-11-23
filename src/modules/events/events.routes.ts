import { Router } from 'express';
import { createEventSchema, eventListQuerySchema, idParamSchema, updateEventSchema } from '../../shared/index';
import { Event, EventRegistration } from '../../database/models/Event';
import { User } from '../../database/models/User';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { asyncHandler, ok } from '../../utils/http';
import { activeRole, findCommunity, hiddenUserIds, myActiveCommunityIds, ROLE_RANK } from '../common/access';
import { userSummary } from '../common/serializers';
import { notify } from '../notifications/notify';
import type { CommunityRole } from '../../shared/index';

const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;
const idp = validate({ params: idParamSchema });

/** The same instant rendered in the zone the host intended, so nothing is silently shifted. */
function localStart(startsAt: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(startsAt);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

async function toDto(events: any[], viewerId: string) {
  const [hosts, regs] = await Promise.all([
    User.find({ _id: { $in: events.map((e) => e.host) } }).select('username displayName avatarUrl').lean(),
    EventRegistration.find({ user: viewerId, event: { $in: events.map((e) => e._id) } }).select('event').lean(),
  ]);
  const hMap = new Map(hosts.map((h) => [String(h._id), h]));
  const rSet = new Set(regs.map((r) => String(r.event)));
  return events.map((e) => ({
    id: String(e._id), title: e.title, description: e.description, type: e.type, status: e.status,
    community: e.community ? String(e.community) : null, host: userSummary(hMap.get(String(e.host))),
    startsAt: e.startsAt.toISOString(), timeZone: e.timeZone, startsAtLocal: localStart(e.startsAt, e.timeZone),
    durationMinutes: e.durationMinutes, capacity: e.capacity ?? null, registeredCount: e.registeredCount, full: e.capacity != null && e.registeredCount >= e.capacity,
    resourceLinks: e.resourceLinks, registered: rSet.has(String(e._id)),
  }));
}

async function loadVisible(id: string, viewerId: string) {
  const e = await Event.findById(id);
  if (!e) throw notFound('Event not found');
  if (e.visibility === 'community' && !(await activeRole(e.community, viewerId))) throw notFound('Event not found');
  if ((await hiddenUserIds(viewerId)).some((h) => String(h) === String(e.host))) throw notFound('Event not found');
  return e;
}

export async function listEvents(viewerId: string, q: { type?: string; community?: string; cursor?: string; limit: number }) {
  const [mine, hidden] = await Promise.all([myActiveCommunityIds(viewerId), hiddenUserIds(viewerId)]);
  const filter: Record<string, any> = { status: 'scheduled', startsAt: { $gte: new Date() }, host: { $nin: hidden }, $or: [{ visibility: 'public' }, { community: { $in: mine } }] };
  if (q.type) filter.type = q.type;
  if (q.community) filter.community = q.community;
  if (q.cursor) { // "startsAtMs:id" keeps ordering stable when several events start at the same minute
    const [ms, id] = q.cursor.split(':');
    const d = new Date(Number(ms));
    filter.$and = [{ $or: [{ startsAt: { $gt: d } }, { startsAt: d, _id: { $gt: id } }] }];
  }
  const rows = await Event.find(filter).sort({ startsAt: 1, _id: 1 }).limit(q.limit + 1).lean();
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return { items: await toDto(page, viewerId), nextCursor: rows.length > q.limit && last ? `${last.startsAt.getTime()}:${last._id}` : null };
}

export const eventsRouter = Router();
eventsRouter.use(authenticate);

eventsRouter.get('/', validate({ query: eventListQuerySchema }), asyncHandler(async (req, res) => {
  const r = await listEvents(uid(req), req.query as any);
  ok(res, r.items, 200, { nextCursor: r.nextCursor, limit: Number((req.query as any).limit) });
}));

eventsRouter.post('/', validate({ body: createEventSchema }), asyncHandler(async (req, res) => {
  const b = req.body;
  if (new Date(b.startsAt) <= new Date()) throw badRequest('The event must start in the future');
  let visibility: 'public' | 'community' = 'public';
  if (b.community) {
    const c = await findCommunity(b.community);
    const role = await activeRole(c._id, uid(req));
    if (!role || ROLE_RANK[role as CommunityRole] < ROLE_RANK.moderator) throw forbidden('Only community moderators can create community events');
    visibility = c.visibility === 'private' ? 'community' : 'public';
  }
  const e = await Event.create({ ...b, startsAt: new Date(b.startsAt), host: uid(req), community: b.community ?? null, visibility });
  ok(res, (await toDto([e.toObject()], uid(req)))[0], 201);
}));

eventsRouter.get('/:id', idp, asyncHandler(async (req, res) => {
  const e = await loadVisible(req.params.id as string, uid(req));
  ok(res, (await toDto([e.toObject()], uid(req)))[0]);
}));

eventsRouter.patch('/:id', idp, validate({ body: updateEventSchema }), asyncHandler(async (req, res) => {
  const e = await Event.findById(req.params.id);
  if (!e || String(e.host) !== uid(req)) throw notFound('Event not found');
  if (e.status === 'cancelled') throw conflict('A cancelled event cannot be changed');
  const { status, startsAt, ...rest } = req.body;
  if (startsAt) { if (new Date(startsAt) <= new Date()) throw badRequest('The event must start in the future'); e.startsAt = new Date(startsAt); }
  for (const k of ['title', 'description', 'type', 'timeZone', 'durationMinutes', 'resourceLinks'] as const) if ((rest as any)[k] !== undefined) (e as any)[k] = (rest as any)[k];
  if (rest.capacity !== undefined) {
    if (rest.capacity < e.registeredCount) throw conflict('Capacity cannot be lower than the number of registered people');
    e.capacity = rest.capacity;
  }
  if (status === 'cancelled') {
    e.status = 'cancelled';
    const regs = await EventRegistration.find({ event: e._id }).select('user').lean();
    for (const r of regs) await notify({ recipient: r.user, actor: uid(req), type: 'event_cancelled', resourceType: 'event', resourceId: e._id });
  }
  await e.save();
  ok(res, (await toDto([e.toObject()], uid(req)))[0]);
}));

eventsRouter.post('/:id/register', idp, asyncHandler(async (req, res) => {
  const e = await loadVisible(req.params.id as string, uid(req));
  if (e.status !== 'scheduled') throw conflict('This event was cancelled', 'EVENT_CANCELLED');
  if (e.startsAt <= new Date()) throw conflict('This event has already started', 'EVENT_STARTED');
  if (await EventRegistration.exists({ event: e._id, user: uid(req) })) return ok(res, { registered: true });
  // Atomic capacity claim: concurrent registrations can never exceed the limit.
  const claimed = await Event.findOneAndUpdate(
    { _id: e._id, status: 'scheduled', $or: [{ capacity: null }, { $expr: { $lt: ['$registeredCount', '$capacity'] } }] },
    { $inc: { registeredCount: 1 } }, { new: true },
  );
  if (!claimed) throw conflict('This event is full', 'EVENT_FULL');
  try {
    await EventRegistration.create({ event: e._id, user: uid(req) });
  } catch (err) {
    await Event.updateOne({ _id: e._id }, { $inc: { registeredCount: -1 } }); // roll back the claim
    if ((err as { code?: number }).code === 11000) return ok(res, { registered: true });
    throw err;
  }
  ok(res, { registered: true, registeredCount: claimed.registeredCount });
}));

eventsRouter.delete('/:id/register', idp, asyncHandler(async (req, res) => {
  const r = await EventRegistration.deleteOne({ event: req.params.id, user: uid(req) });
  if (r.deletedCount) await Event.updateOne({ _id: req.params.id }, { $inc: { registeredCount: -1 } });
  ok(res, { registered: false });
}));
