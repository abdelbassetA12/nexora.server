import { Router } from 'express';
import {
  createProjectSchema, createTaskSchema, cursorQuerySchema, idParamSchema, joinRequestSchema, projectListQuerySchema,
  projectMemberParamsSchema, taskCommentSchema, taskListQuerySchema, updateProjectSchema, updateTaskSchema,
} from '../../shared/index';
import { Project, ProjectMembership, ProjectTask, TaskActivity, TaskComment } from '../../database/models/Project';
import { User } from '../../database/models/User';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { asyncHandler, ok } from '../../utils/http';
import { buildPage } from '../../utils/pagination';
import { hiddenUserIds } from '../common/access';
import { userSummary } from '../common/serializers';
import { notify } from '../notifications/notify';
import { award } from '../achievements/achievements';

const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;
const idp = validate({ params: idParamSchema });
const RANK = { member: 1, maintainer: 2, owner: 3 } as const;
type PRole = keyof typeof RANK;

const membership = (project: unknown, user: string) => ProjectMembership.findOne({ project, user });
async function activeMember(project: unknown, user: string) {
  const m = await membership(project, user);
  return m && m.status === 'active' ? m : null;
}
async function loadForViewer(id: string, userId: string) {
  const p = await Project.findById(id);
  if (!p) throw notFound('Project not found');
  const m = await activeMember(p._id, userId);
  if (p.visibility === 'private' && !m) throw notFound('Project not found'); // private projects do not exist for outsiders
  return { project: p, member: m };
}
const requireMember = async (id: string, userId: string) => {
  const { project, member } = await loadForViewer(id, userId);
  if (!member) throw forbidden('Join this project to see its tasks');
  return { project, member };
};
const requireRole = (m: { role: string }, min: PRole) => { if (RANK[m.role as PRole] < RANK[min]) throw forbidden('You do not have permission in this project'); };

/** Progress is computed from the real task states; never from client input. */
async function progress(projectId: unknown) {
  const rows = await ProjectTask.aggregate([{ $match: { project: projectId } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.n])) as Record<string, number>;
  const total = rows.reduce((s, r) => s + r.n, 0);
  return { total, done: by.done ?? 0, byStatus: by, percent: total ? Math.round(((by.done ?? 0) / total) * 100) : 0 };
}

async function projectDto(p: any, viewerId: string, member: any) {
  const [owner, memberCount, prog] = await Promise.all([
    User.findById(p.owner).select('username displayName avatarUrl').lean(),
    ProjectMembership.countDocuments({ project: p._id, status: 'active' }),
    member ? progress(p._id) : Promise.resolve(null), // task data is members-only
  ]);
  return {
    id: String(p._id), title: p.title, description: p.description, category: p.category, skills: p.skills, goals: p.goals, deliverables: p.deliverables,
    visibility: p.visibility, status: p.status, deadline: p.deadline?.toISOString() ?? null, owner: userSummary(owner), memberCount,
    myMembership: member ? { role: member.role } : null, progress: prog, createdAt: p.createdAt.toISOString(),
  };
}

export const projectsRouter = Router();
projectsRouter.use(authenticate);

projectsRouter.get('/', validate({ query: projectListQuerySchema }), asyncHandler(async (req, res) => {
  const { skill, cursor, limit } = req.query as any;
  const mine = (await ProjectMembership.find({ user: uid(req), status: 'active' }).select('project').lean()).map((m) => m.project);
  const filter: Record<string, any> = { status: { $ne: 'archived' }, $or: [{ visibility: 'public' }, { _id: { $in: mine } }] };
  if (skill) filter.skills = skill;
  if (cursor) filter._id = { $lt: cursor };
  const rows = await Project.find(filter).sort({ _id: -1 }).limit(limit + 1);
  const { items, meta } = buildPage(rows, limit);
  const ms = await ProjectMembership.find({ user: uid(req), project: { $in: items.map((i) => i._id) }, status: 'active' }).lean();
  const mMap = new Map(ms.map((m) => [String(m.project), m]));
  ok(res, await Promise.all(items.map((p) => projectDto(p, uid(req), mMap.get(String(p._id))))), 200, meta);
}));

projectsRouter.post('/', validate({ body: createProjectSchema }), asyncHandler(async (req, res) => {
  const p = await Project.create({ ...req.body, owner: uid(req), deadline: req.body.deadline ? new Date(req.body.deadline) : null });
  const m = await ProjectMembership.create({ project: p._id, user: uid(req), role: 'owner' });
  ok(res, await projectDto(p, uid(req), m), 201);
}));

projectsRouter.get('/:id', idp, asyncHandler(async (req, res) => {
  const { project, member } = await loadForViewer(req.params.id as string, uid(req));
  const dto = await projectDto(project, uid(req), member);
  const pending = !member ? await ProjectMembership.exists({ project: project._id, user: uid(req), status: 'pending' }) : null;
  ok(res, { ...dto, joinRequestPending: Boolean(pending) });
}));

projectsRouter.patch('/:id', idp, validate({ body: updateProjectSchema }), asyncHandler(async (req, res) => {
  const { project, member } = await requireMember(req.params.id as string, uid(req));
  requireRole(member!, 'maintainer');
  const b = req.body;
  if (b.visibility && b.visibility !== project.visibility) requireRole(member!, 'owner');
  for (const k of ['title', 'description', 'category', 'skills', 'goals', 'deliverables', 'visibility', 'status'] as const) if (b[k] !== undefined) (project as any)[k] = b[k];
  if (b.deadline !== undefined) project.deadline = new Date(b.deadline);
  await project.save();
  ok(res, await projectDto(project, uid(req), member));
}));

projectsRouter.get('/:id/members', idp, validate({ query: cursorQuerySchema }), asyncHandler(async (req, res) => {
  const { project } = await loadForViewer(req.params.id as string, uid(req));
  const { cursor, limit } = req.query as any;
  const rows = await ProjectMembership.find({ project: project._id, status: 'active', ...(cursor ? { _id: { $lt: cursor } } : {}) }).sort({ _id: -1 }).limit(limit + 1).lean();
  const { items, meta } = buildPage(rows, limit);
  const users = await User.find({ _id: { $in: items.map((i) => i.user) } }).select('username displayName avatarUrl').lean();
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  ok(res, items.map((m) => ({ role: m.role, user: userSummary(uMap.get(String(m.user))) })), 200, meta);
}));

projectsRouter.post('/:id/join-requests', idp, validate({ body: joinRequestSchema }), asyncHandler(async (req, res) => {
  const { project, member } = await loadForViewer(req.params.id as string, uid(req));
  if (member) throw conflict('You are already a member');
  if (project.visibility === 'private') throw notFound('Project not found');
  if ((await hiddenUserIds(uid(req))).some((h) => String(h) === String(project.owner))) throw forbidden('You cannot join this project');
  try { await ProjectMembership.create({ project: project._id, user: uid(req), role: 'member', status: 'pending', message: req.body.message }); }
  catch (e) { if ((e as { code?: number }).code === 11000) return ok(res, { status: 'pending' }); throw e; }
  await notify({ recipient: project.owner, actor: uid(req), type: 'project_join_request', resourceType: 'project', resourceId: project._id });
  ok(res, { status: 'pending' }, 201);
}));

projectsRouter.get('/:id/join-requests', idp, asyncHandler(async (req, res) => {
  const { project, member } = await requireMember(req.params.id as string, uid(req));
  requireRole(member!, 'maintainer');
  const rows = await ProjectMembership.find({ project: project._id, status: 'pending' }).sort({ _id: 1 }).limit(50).lean();
  const users = await User.find({ _id: { $in: rows.map((r) => r.user) } }).select('username displayName avatarUrl').lean();
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  ok(res, rows.map((r) => ({ user: userSummary(uMap.get(String(r.user))), message: r.message, requestedAt: r.createdAt.toISOString() })));
}));

for (const decision of ['approve', 'reject'] as const) {
  projectsRouter.post(`/:id/join-requests/:userId/${decision}`, validate({ params: projectMemberParamsSchema }), asyncHandler(async (req, res) => {
    const { project, member } = await requireMember(req.params.id as string, uid(req));
    requireRole(member!, 'maintainer');
    if (decision === 'approve') {
      const m = await ProjectMembership.findOneAndUpdate({ project: project._id, user: req.params.userId, status: 'pending' }, { status: 'active' });
      if (!m) throw notFound('No pending request for this user');
      await notify({ recipient: req.params.userId, actor: uid(req), type: 'project_join_approved', resourceType: 'project', resourceId: project._id });
    } else if (!(await ProjectMembership.deleteOne({ project: project._id, user: req.params.userId, status: 'pending' })).deletedCount) throw notFound('No pending request for this user');
    ok(res, { [decision === 'approve' ? 'approved' : 'rejected']: true });
  }));
}

// ---------- tasks ----------
projectsRouter.get('/:id/tasks', idp, validate({ query: taskListQuerySchema }), asyncHandler(async (req, res) => {
  const { project } = await requireMember(req.params.id as string, uid(req));
  const { status, cursor, limit } = req.query as any;
  const rows = await ProjectTask.find({ project: project._id, ...(status ? { status } : {}), ...(cursor ? { _id: { $lt: cursor } } : {}) }).sort({ _id: -1 }).limit(limit + 1).lean();
  const { items, meta } = buildPage(rows, limit);
  ok(res, await taskDtos(items), 200, meta);
}));

projectsRouter.post('/:id/tasks', idp, validate({ body: createTaskSchema }), asyncHandler(async (req, res) => {
  const { project } = await requireMember(req.params.id as string, uid(req));
  const b = req.body;
  if (b.assignee && !(await activeMember(project._id, b.assignee))) throw badRequest('The assignee must be a project member');
  const t = await ProjectTask.create({ project: project._id, creator: uid(req), assignee: b.assignee ?? null, title: b.title, description: b.description, priority: b.priority, dueDate: b.dueDate ? new Date(b.dueDate) : null });
  await TaskActivity.create({ task: t._id, actor: uid(req), action: 'created' });
  if (b.assignee) await notify({ recipient: b.assignee, actor: uid(req), type: 'task_assigned', resourceType: 'task', resourceId: t._id });
  ok(res, (await taskDtos([t.toObject()]))[0], 201);
}));

async function taskDtos(tasks: any[]) {
  const users = await User.find({ _id: { $in: tasks.flatMap((t) => [t.assignee, t.creator]).filter(Boolean) } }).select('username displayName avatarUrl').lean();
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  return tasks.map((t) => ({
    id: String(t._id), projectId: String(t.project), title: t.title, description: t.description, priority: t.priority, status: t.status,
    dueDate: t.dueDate?.toISOString() ?? null, completedAt: t.completedAt?.toISOString() ?? null,
    assignee: t.assignee ? userSummary(uMap.get(String(t.assignee))) : null, creator: userSummary(uMap.get(String(t.creator))),
  }));
}

export const tasksRouter = Router();
tasksRouter.use(authenticate);

async function loadTask(id: string, userId: string) {
  const t = await ProjectTask.findById(id);
  if (!t) throw notFound('Task not found');
  const m = await activeMember(t.project, userId);
  if (!m) throw notFound('Task not found'); // non-members cannot tell it exists
  return { task: t, member: m };
}

tasksRouter.get('/:id', idp, asyncHandler(async (req, res) => {
  const { task } = await loadTask(req.params.id as string, uid(req));
  const activity = await TaskActivity.find({ task: task._id }).sort({ _id: 1 }).limit(100).lean();
  ok(res, { ...(await taskDtos([task.toObject()]))[0], activity: activity.map((a) => ({ action: a.action, actor: String(a.actor), from: a.from ?? null, to: a.to ?? null, at: a.createdAt.toISOString() })) });
}));

tasksRouter.patch('/:id', idp, validate({ body: updateTaskSchema }), asyncHandler(async (req, res) => {
  const { task, member } = await loadTask(req.params.id as string, uid(req));
  const me = uid(req);
  const b = req.body;
  const privileged = RANK[member.role as PRole] >= RANK.maintainer || String(task.creator) === me;
  const isAssignee = task.assignee && String(task.assignee) === me;
  const touchesContent = ['title', 'description', 'priority', 'dueDate', 'assignee'].some((k) => b[k] !== undefined);
  if (touchesContent && !privileged) throw forbidden('Only the creator or a maintainer can edit this task');
  if (b.status !== undefined && !privileged && !isAssignee) throw forbidden('Only the assignee, creator or a maintainer can change the status');

  if (b.assignee !== undefined) {
    if (b.assignee && !(await activeMember(task.project, b.assignee))) throw badRequest('The assignee must be a project member');
    if (String(b.assignee ?? '') !== String(task.assignee ?? '')) {
      await TaskActivity.create({ task: task._id, actor: me, action: 'assigned', from: task.assignee ? String(task.assignee) : undefined, to: b.assignee ?? undefined });
      if (b.assignee) await notify({ recipient: b.assignee, actor: me, type: 'task_assigned', resourceType: 'task', resourceId: task._id });
    }
    task.assignee = b.assignee;
  }
  if (b.title !== undefined) task.title = b.title;
  if (b.description !== undefined) task.description = b.description;
  if (b.priority !== undefined) task.priority = b.priority;
  if (b.dueDate !== undefined) task.dueDate = b.dueDate ? new Date(b.dueDate) : null;
  if (touchesContent && b.assignee === undefined) await TaskActivity.create({ task: task._id, actor: me, action: 'edited' });
  if (b.status !== undefined && b.status !== task.status) {
    await TaskActivity.create({ task: task._id, actor: me, action: 'status_changed', from: task.status, to: b.status });
    task.status = b.status;
    task.completedAt = b.status === 'done' ? new Date() : null;
    // Only counts in a real team project (2+ members), so solo self-assignment cannot farm it.
    if (b.status === 'done' && task.assignee && (await ProjectMembership.countDocuments({ project: task.project, status: 'active' })) >= 2) await award(task.assignee, 'first_team_task_done', 'task', task._id);
  }
  await task.save();
  ok(res, (await taskDtos([task.toObject()]))[0]);
}));

tasksRouter.get('/:id/comments', idp, validate({ query: cursorQuerySchema }), asyncHandler(async (req, res) => {
  const { task } = await loadTask(req.params.id as string, uid(req));
  const { cursor, limit } = req.query as any;
  const rows = await TaskComment.find({ task: task._id, ...(cursor ? { _id: { $gt: cursor } } : {}) }).sort({ _id: 1 }).limit(limit + 1).lean();
  const { items, meta } = buildPage(rows, limit);
  const users = await User.find({ _id: { $in: items.map((i) => i.author) } }).select('username displayName avatarUrl').lean();
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  ok(res, items.map((c) => ({ id: String(c._id), body: c.body, author: userSummary(uMap.get(String(c.author))), createdAt: c.createdAt.toISOString() })), 200, meta);
}));

tasksRouter.post('/:id/comments', idp, validate({ body: taskCommentSchema }), asyncHandler(async (req, res) => {
  const { task } = await loadTask(req.params.id as string, uid(req));
  const c = await TaskComment.create({ task: task._id, author: uid(req), body: req.body.body });
  ok(res, { id: String(c._id), body: c.body, createdAt: c.createdAt.toISOString() }, 201);
}));

export async function listUserProjects(userId: string, viewerId: string) {
  const ms = await ProjectMembership.find({ user: userId, status: 'active' }).select('project role').lean();
  const projects = await Project.find({ _id: { $in: ms.map((m) => m.project) }, visibility: 'public', status: { $ne: 'archived' } }).limit(50);
  return Promise.all(projects.map((p) => projectDto(p, viewerId, null)));
}
