import { Router } from 'express';
import {
  createExchangeSchema, createSkillOfferSchema, createSkillRequestSchema, exchangeFeedbackSchema, exchangeListQuerySchema,
  idParamSchema, scheduleExchangeSchema, skillListQuerySchema,
} from '../../shared/index';
import { SkillExchange, SkillOffer, SkillRequest } from '../../database/models/SkillOffer';
import { User } from '../../database/models/User';
import { UserSkill } from '../../database/models/UserSkill';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { asyncHandler, ok } from '../../utils/http';
import { buildPage } from '../../utils/pagination';
import { slugify } from '../users/users.service';
import { escapeRegex, hiddenUserIds, isBlockedBetween, myActiveCommunityIds } from '../common/access';
import { userSummary } from '../common/serializers';
import { notify } from '../notifications/notify';
import { award } from '../achievements/achievements';

const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;
const idp = validate({ params: idParamSchema });
const USER_FIELDS = 'username displayName avatarUrl';

async function withOwners<T extends { owner: unknown }>(rows: T[]) {
  const users = await User.find({ _id: { $in: rows.map((r) => r.owner) } }).select(USER_FIELDS).lean();
  const m = new Map(users.map((u) => [String(u._id), u]));
  return rows.map((r) => ({ ...r, owner: userSummary(m.get(String(r.owner))) }));
}
const listingDto = (r: any) => ({ id: String(r._id), title: r.title, description: r.description, skill: r.skill, format: r.format, language: r.language, availability: r.availability, status: r.status, owner: r.owner, audience: r.audience, createdAt: r.createdAt.toISOString() });

export const skillOffersRouter = Router();
skillOffersRouter.use(authenticate);
skillOffersRouter.get('/', validate({ query: skillListQuerySchema }), asyncHandler(async (req, res) => {
  const { skill, language, format, cursor, limit } = req.query as any;
  const hidden = await hiddenUserIds(uid(req));
  const filter: Record<string, unknown> = { status: 'open', owner: { $nin: hidden } };
  if (skill) filter.skillKey = new RegExp(`^${escapeRegex(slugify(skill))}`);
  if (language) filter.language = language;
  if (format) filter.format = format;
  if (cursor) filter._id = { $lt: cursor };
  const rows = await SkillOffer.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const { items, meta } = buildPage(rows, limit);
  ok(res, (await withOwners(items as any[])).map(listingDto), 200, meta);
}));
skillOffersRouter.post('/', validate({ body: createSkillOfferSchema }), asyncHandler(async (req, res) => {
  const o = await SkillOffer.create({ ...req.body, owner: uid(req), skillKey: slugify(req.body.skill) });
  ok(res, listingDto((await withOwners([o.toObject() as any]))[0]), 201);
}));

export const skillRequestsRouter = Router();
skillRequestsRouter.use(authenticate);
skillRequestsRouter.get('/', validate({ query: skillListQuerySchema }), asyncHandler(async (req, res) => {
  const { skill, language, format, cursor, limit } = req.query as any;
  const [hidden, communities] = await Promise.all([hiddenUserIds(uid(req)), myActiveCommunityIds(uid(req))]);
  // Visibility: open to all, directed to me, mine, or scoped to a community I belong to.
  const filter: Record<string, unknown> = {
    status: 'open', owner: { $nin: hidden },
    $or: [{ audience: 'open' }, { owner: uid(req) }, { targetUser: uid(req) }, { audience: 'community', community: { $in: communities } }],
  };
  if (skill) filter.skillKey = new RegExp(`^${escapeRegex(slugify(skill))}`);
  if (language) filter.language = language;
  if (format) filter.format = format;
  if (cursor) filter._id = { $lt: cursor };
  const rows = await SkillRequest.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const { items, meta } = buildPage(rows, limit);
  ok(res, (await withOwners(items as any[])).map(listingDto), 200, meta);
}));
skillRequestsRouter.post('/', validate({ body: createSkillRequestSchema }), asyncHandler(async (req, res) => {
  const b = req.body;
  if (b.audience === 'direct' && (b.targetUser === uid(req) || !(await User.exists({ _id: b.targetUser, status: 'active' })))) throw badRequest('Choose another user for a direct request');
  if (b.audience === 'community' && !(await myActiveCommunityIds(uid(req))).some((c) => String(c) === b.community)) throw forbidden('You can only post to communities you belong to');
  const r = await SkillRequest.create({ ...b, owner: uid(req), skillKey: slugify(b.skill) });
  ok(res, listingDto((await withOwners([r.toObject() as any]))[0]), 201);
}));

// ---------- exchanges (explicit state machine) ----------
const ACTIVE = ['proposed', 'accepted', 'scheduled'];
async function exchangeDto(e: any) {
  const users = await User.find({ _id: { $in: [e.initiator, e.responder] } }).select(USER_FIELDS).lean();
  const m = new Map(users.map((u) => [String(u._id), u]));
  return {
    id: String(e._id), status: e.status, skill: e.skill, message: e.message, offeredInReturn: e.offeredInReturn,
    initiator: userSummary(m.get(String(e.initiator))), responder: userSummary(m.get(String(e.responder))),
    offerId: e.offer ? String(e.offer) : null, requestId: e.request ? String(e.request) : null,
    scheduledAt: e.scheduledAt?.toISOString() ?? null, confirmedBy: e.confirmedBy.map(String),
    feedback: e.feedback.map((f: any) => ({ from: String(f.from), rating: f.rating, comment: f.comment ?? '' })), createdAt: e.createdAt.toISOString(),
  };
}
async function mine(id: string, userId: string) {
  const e = await SkillExchange.findOne({ _id: id, $or: [{ initiator: userId }, { responder: userId }] });
  if (!e) throw notFound('Exchange not found'); // third parties cannot tell it exists
  return e;
}

export const exchangesRouter = Router();
exchangesRouter.use(authenticate);

exchangesRouter.get('/', validate({ query: exchangeListQuerySchema }), asyncHandler(async (req, res) => {
  const { status, cursor, limit } = req.query as any;
  const filter: Record<string, unknown> = { $or: [{ initiator: uid(req) }, { responder: uid(req) }], ...(status ? { status } : {}) };
  if (cursor) filter._id = { $lt: cursor };
  const rows = await SkillExchange.find(filter).sort({ _id: -1 }).limit(limit + 1);
  const { items, meta } = buildPage(rows, limit);
  ok(res, await Promise.all(items.map(exchangeDto)), 200, meta);
}));

exchangesRouter.get('/matches', asyncHandler(async (req, res) => {
  const me = uid(req);
  const [mySkills, hidden, meDoc] = await Promise.all([UserSkill.find({ user: me }).lean(), hiddenUserIds(me), User.findById(me).select('languages').lean()]);
  const learn = mySkills.filter((s) => s.kind === 'learn').map((s) => s.skillKey);
  const teach = mySkills.filter((s) => s.kind === 'teach').map((s) => s.skillKey);
  if (!learn.length) return ok(res, []);
  const teachers = await UserSkill.find({ kind: 'teach', skillKey: { $in: learn }, user: { $nin: [...hidden, me] } }).limit(200).lean();
  const ids = [...new Set(teachers.map((t) => String(t.user)))];
  const [users, wants] = await Promise.all([
    User.find({ _id: { $in: ids }, status: 'active' }).select(`${USER_FIELDS} languages`).lean(),
    UserSkill.find({ user: { $in: ids }, kind: 'learn', skillKey: { $in: teach } }).lean(),
  ]);
  const results = users.map((u) => {
    const theyTeach = teachers.filter((t) => String(t.user) === String(u._id)).map((t) => t.name);
    const youTeach = wants.filter((w) => String(w.user) === String(u._id)).map((w) => w.name);
    const sharedLanguages = (u.languages ?? []).filter((l) => (meDoc?.languages ?? []).includes(l));
    // Every match carries the concrete reasons behind it. No invented "compatibility score".
    const reasons = [
      ...theyTeach.map((s) => `They can teach ${s}, which you want to learn`),
      ...youTeach.map((s) => `You can teach ${s}, which they want to learn`),
      ...(sharedLanguages.length ? [`You both use: ${sharedLanguages.join(', ')}`] : []),
    ];
    return { user: userSummary(u), theyTeach, youTeach, reciprocal: youTeach.length > 0, reasons, selfDeclared: true };
  });
  results.sort((a, b) => Number(b.reciprocal) - Number(a.reciprocal) || b.reasons.length - a.reasons.length);
  ok(res, results.slice(0, 20));
}));

exchangesRouter.post('/', validate({ body: createExchangeSchema }), asyncHandler(async (req, res) => {
  const { offerId, requestId, message, offeredInReturn } = req.body;
  let responder: unknown; let skill: string;
  if (offerId) {
    const o = await SkillOffer.findOne({ _id: offerId, status: 'open' }).lean();
    if (!o) throw notFound('Offer not found');
    responder = o.owner; skill = o.skill;
  } else {
    const r = await SkillRequest.findOne({ _id: requestId, status: 'open' }).lean();
    if (!r) throw notFound('Request not found');
    const communities = await myActiveCommunityIds(uid(req));
    const visible = r.audience === 'open' || String(r.targetUser) === uid(req) || (r.audience === 'community' && communities.some((c) => String(c) === String(r.community)));
    if (!visible) throw notFound('Request not found');
    responder = r.owner; skill = r.skill; // the request owner decides whether to accept the helper
  }
  if (String(responder) === uid(req)) throw badRequest('You cannot start an exchange with yourself');
  if (await isBlockedBetween(uid(req), String(responder))) throw forbidden('You cannot start an exchange with this user');
  const dup = await SkillExchange.exists({ initiator: uid(req), responder, ...(offerId ? { offer: offerId } : { request: requestId }), status: { $in: ACTIVE } });
  if (dup) throw conflict('You already have an open exchange for this listing', 'DUPLICATE_EXCHANGE');
  const e = await SkillExchange.create({ initiator: uid(req), responder, offer: offerId ?? null, request: requestId ?? null, skill, message, offeredInReturn: offeredInReturn ?? '' });
  await notify({ recipient: responder, actor: uid(req), type: 'exchange_request', resourceType: 'exchange', resourceId: e._id });
  ok(res, await exchangeDto(e), 201);
}));

exchangesRouter.get('/:id', idp, asyncHandler(async (req, res) => ok(res, await exchangeDto(await mine(req.params.id as string, uid(req))))));

async function transition(req: any, res: any, rule: (e: any, me: string) => string | null, apply: (e: any, me: string) => Promise<void>) {
  const me = uid(req);
  const e = await mine(req.params.id, me);
  const problem = rule(e, me);
  if (problem) throw conflict(problem, 'INVALID_TRANSITION');
  await apply(e, me);
  await e.save();
  ok(res, await exchangeDto(e));
}
const onlyResponder = (e: any, me: string) => (String(e.responder) !== me ? 'Only the person who received the request can do this' : e.status !== 'proposed' ? `This exchange is already ${e.status}` : null);

exchangesRouter.post('/:id/accept', idp, asyncHandler((req, res) => transition(req, res, onlyResponder, async (e, me) => {
  e.status = 'accepted';
  await notify({ recipient: e.initiator, actor: me, type: 'exchange_accepted', resourceType: 'exchange', resourceId: e._id });
})));
exchangesRouter.post('/:id/decline', idp, asyncHandler((req, res) => transition(req, res, onlyResponder, async (e, me) => {
  e.status = 'declined';
  await notify({ recipient: e.initiator, actor: me, type: 'exchange_declined', resourceType: 'exchange', resourceId: e._id });
})));
exchangesRouter.post('/:id/cancel', idp, asyncHandler((req, res) => transition(req, res,
  (e, me) => (!ACTIVE.includes(e.status) ? `This exchange is already ${e.status}` : e.status === 'proposed' && String(e.initiator) !== me ? 'Use decline to refuse a request' : null),
  async (e) => { e.status = 'cancelled'; })));
exchangesRouter.post('/:id/schedule', idp, validate({ body: scheduleExchangeSchema }), asyncHandler((req, res) => transition(req, res,
  (e) => (!['accepted', 'scheduled'].includes(e.status) ? 'Only an accepted exchange can be scheduled' : new Date(req.body.scheduledAt) <= new Date() ? 'Choose a time in the future' : null),
  async (e) => { e.scheduledAt = new Date(req.body.scheduledAt); e.status = 'scheduled'; e.confirmedBy = []; })));
exchangesRouter.post('/:id/complete', idp, asyncHandler((req, res) => transition(req, res,
  (e) => (!['accepted', 'scheduled', 'completed'].includes(e.status) ? 'Only an accepted or scheduled exchange can be completed' : null),
  async (e, me) => {
    if (e.status === 'completed' || e.confirmedBy.some((c: unknown) => String(c) === me)) return; // idempotent
    e.confirmedBy.push(me as never);
    if (e.confirmedBy.length >= 2) { // completed only when BOTH participants confirm
      e.status = 'completed';
      await Promise.all([award(e.initiator, 'first_exchange_completed', 'exchange', e._id), award(e.responder, 'first_exchange_completed', 'exchange', e._id)]);
    }
  })));
exchangesRouter.post('/:id/feedback', idp, validate({ body: exchangeFeedbackSchema }), asyncHandler((req, res) => transition(req, res,
  (e, me) => (e.status !== 'completed' ? 'Feedback is available after the exchange is completed' : e.feedback.some((f: any) => String(f.from) === me) ? 'You already left feedback' : null),
  async (e, me) => { e.feedback.push({ from: me, rating: req.body.rating, comment: req.body.comment, createdAt: new Date() } as never); })));
