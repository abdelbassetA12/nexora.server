import { Router } from 'express';
import { createGoalSchema, createMilestoneSchema, goalListQuerySchema, idParamSchema, updateGoalSchema, updateMilestoneSchema } from '../../shared/index';
import { Goal, GoalMilestone, GoalProgress } from '../../database/models/Goal';
import { Project, ProjectMembership } from '../../database/models/Project';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { conflict, forbidden, notFound } from '../../utils/errors';
import { asyncHandler, ok } from '../../utils/http';
import { buildPage } from '../../utils/pagination';
import { activeRole } from '../common/access';
import { award } from '../achievements/achievements';

const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;
const idp = validate({ params: idParamSchema });

const progressOf = (ms: Array<{ completedAt?: Date | null }>) => {
  const total = ms.length; const done = ms.filter((m) => m.completedAt).length;
  // Progress is derived from completed milestones only; the client can never set it.
  return { done, total, percent: total ? Math.round((done / total) * 100) : null };
};
const mDto = (m: { _id: unknown; title: string; dueDate?: Date | null; completedAt?: Date | null }) => ({ id: String(m._id), title: m.title, dueDate: m.dueDate?.toISOString() ?? null, completed: Boolean(m.completedAt), completedAt: m.completedAt?.toISOString() ?? null });
const gDto = (g: any, ms: any[]) => ({
  id: String(g._id), title: g.title, description: g.description, category: g.category, status: g.status,
  startDate: g.startDate.toISOString(), targetDate: g.targetDate?.toISOString() ?? null, completedAt: g.completedAt?.toISOString() ?? null,
  project: g.project ? String(g.project) : null, community: g.community ? String(g.community) : null,
  progress: progressOf(ms), milestones: ms.map(mDto),
});

async function ownGoal(id: string, userId: string) {
  const g = await Goal.findOne({ _id: id, user: userId });
  if (!g) throw notFound('Goal not found'); // other users' goals are indistinguishable from missing
  return g;
}

export const goalsRouter = Router();
goalsRouter.use(authenticate);

goalsRouter.get('/', validate({ query: goalListQuerySchema }), asyncHandler(async (req, res) => {
  const { status, cursor, limit } = req.query as unknown as { status?: string; cursor?: string; limit: number };
  const filter: Record<string, unknown> = { user: uid(req), ...(status ? { status } : { status: { $ne: 'archived' } }) };
  if (cursor) filter._id = { $lt: cursor };
  const rows = await Goal.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const { items, meta } = buildPage(rows, limit);
  const ms = await GoalMilestone.find({ goal: { $in: items.map((i) => i._id) } }).sort({ _id: 1 }).lean(); // bounded: <= 20 per goal
  ok(res, items.map((g) => gDto(g, ms.filter((m) => String(m.goal) === String(g._id)))), 200, meta);
}));

goalsRouter.post('/', validate({ body: createGoalSchema }), asyncHandler(async (req, res) => {
  const b = req.body;
  if (b.project) {
    const m = await ProjectMembership.findOne({ project: b.project, user: uid(req), status: 'active' });
    if (!m) throw forbidden('You can only link a project you belong to');
  }
  if (b.community && !(await activeRole(b.community, uid(req)))) throw forbidden('You can only link a community you belong to');
  const goal = await Goal.create({ user: uid(req), title: b.title, description: b.description, category: b.category, targetDate: b.targetDate, project: b.project ?? null, community: b.community ?? null });
  const ms = b.milestones.length ? await GoalMilestone.insertMany(b.milestones.map((title: string) => ({ goal: goal._id, user: uid(req), title }))) : [];
  ok(res, gDto(goal, ms as any[]), 201);
}));

goalsRouter.get('/:id', idp, asyncHandler(async (req, res) => {
  const g = await ownGoal(req.params.id as string, uid(req));
  const [ms, history] = await Promise.all([GoalMilestone.find({ goal: g._id }).sort({ _id: 1 }).lean(), GoalProgress.find({ goal: g._id }).sort({ _id: -1 }).limit(50).lean()]);
  ok(res, { ...gDto(g, ms), history: history.map((h) => ({ type: h.type, milestoneId: h.milestone ? String(h.milestone) : null, at: h.createdAt.toISOString() })) });
}));

goalsRouter.patch('/:id', idp, validate({ body: updateGoalSchema }), asyncHandler(async (req, res) => {
  const g = await ownGoal(req.params.id as string, uid(req));
  const ms = await GoalMilestone.find({ goal: g._id }).lean();
  const { status, ...rest } = req.body;
  if (status === 'completed' && g.status !== 'completed') {
    if (ms.some((m) => !m.completedAt)) throw conflict('Complete all milestones before completing the goal', 'MILESTONES_PENDING');
    g.status = 'completed'; g.completedAt = new Date();
    await GoalProgress.create({ goal: g._id, type: 'goal_completed' });
    await award(g.user, 'first_goal_completed', 'goal', g._id);
  } else if (status && status !== 'completed') { g.status = status; if (g.completedAt) g.completedAt = null; }
  if (rest.title !== undefined) g.title = rest.title;
  if (rest.description !== undefined) g.description = rest.description;
  if (rest.category !== undefined) g.category = rest.category;
  if (rest.targetDate !== undefined) g.targetDate = rest.targetDate ? new Date(rest.targetDate) : null;
  await g.save();
  ok(res, gDto(g, ms));
}));

goalsRouter.delete('/:id', idp, asyncHandler(async (req, res) => {
  const g = await ownGoal(req.params.id as string, uid(req));
  await Promise.all([GoalMilestone.deleteMany({ goal: g._id }), GoalProgress.deleteMany({ goal: g._id })]); // no orphans
  await g.deleteOne();
  ok(res, { deleted: true });
}));

goalsRouter.post('/:id/milestones', idp, validate({ body: createMilestoneSchema }), asyncHandler(async (req, res) => {
  const g = await ownGoal(req.params.id as string, uid(req));
  if (g.status !== 'active') throw conflict('Milestones can only be added to active goals');
  if ((await GoalMilestone.countDocuments({ goal: g._id })) >= 20) throw conflict('A goal can have at most 20 milestones');
  const m = await GoalMilestone.create({ goal: g._id, user: uid(req), title: req.body.title, dueDate: req.body.dueDate });
  ok(res, mDto(m), 201);
}));

export const milestonesRouter = Router();
milestonesRouter.use(authenticate);
milestonesRouter.patch('/:id', idp, validate({ body: updateMilestoneSchema }), asyncHandler(async (req, res) => {
  const m = await GoalMilestone.findOne({ _id: req.params.id, user: uid(req) });
  if (!m) throw notFound('Milestone not found');
  const goal = await Goal.findById(m.goal);
  if (!goal || goal.status === 'archived') throw notFound('Milestone not found');
  const { completed, title, dueDate } = req.body;
  if (title !== undefined) m.title = title;
  if (dueDate !== undefined) m.dueDate = dueDate ? new Date(dueDate) : null;
  if (completed === true && !m.completedAt) { m.completedAt = new Date(); await GoalProgress.create({ goal: m.goal, type: 'milestone_completed', milestone: m._id }); }
  if (completed === false && m.completedAt) { m.completedAt = null; await GoalProgress.create({ goal: m.goal, type: 'milestone_reopened', milestone: m._id }); }
  await m.save();
  ok(res, mDto(m));
}));
