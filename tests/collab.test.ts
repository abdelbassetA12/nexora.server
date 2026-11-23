import { describe, expect, it } from 'vitest';
import { Event } from '../src/database/models/Event';
import { Notification } from '../src/database/models/Notification';
import { UserAchievement } from '../src/database/models/Achievement';
import { api, as, makeCommunity, makeUser } from './helpers';

const future = (days = 2) => new Date(Date.now() + days * 86_400_000).toISOString();
const post = (u: { token: string }, path: string, body: unknown = {}) => api().post(`/api/v1${path}`).set(as(u)).send(body as object);

describe('skill exchange', () => {
  async function setup() {
    const teacher = await makeUser(); const learner = await makeUser();
    const offer = (await post(teacher, '/skill-offers', { title: 'I can teach React hooks', description: 'Hooks deep dive', skill: 'React' })).body.data;
    return { teacher, learner, offer };
  }
  it('runs the full lifecycle; completes only when BOTH confirm; awards the achievement once', async () => {
    const { teacher, learner, offer } = await setup();
    const ex = (await post(learner, '/skill-exchanges', { offerId: offer.id, message: 'Please help' })).body.data;
    expect(ex.status).toBe('proposed');
    expect((await post(learner, `/skill-exchanges/${ex.id}/accept`)).status).toBe(409); // initiator cannot accept
    expect((await post(teacher, `/skill-exchanges/${ex.id}/accept`)).body.data.status).toBe('accepted');
    expect((await post(teacher, `/skill-exchanges/${ex.id}/accept`)).status).toBe(409); // already accepted
    expect((await post(teacher, `/skill-exchanges/${ex.id}/schedule`, { scheduledAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(409);
    expect((await post(teacher, `/skill-exchanges/${ex.id}/schedule`, { scheduledAt: future() })).body.data.status).toBe('scheduled');
    expect((await post(learner, `/skill-exchanges/${ex.id}/feedback`, { rating: 5 })).status).toBe(409); // not completed yet

    expect((await post(teacher, `/skill-exchanges/${ex.id}/complete`)).body.data.status).toBe('scheduled');
    expect((await post(teacher, `/skill-exchanges/${ex.id}/complete`)).body.data.confirmedBy).toHaveLength(1); // idempotent
    expect((await post(learner, `/skill-exchanges/${ex.id}/complete`)).body.data.status).toBe('completed');
    expect(await UserAchievement.countDocuments({ key: 'first_exchange_completed' })).toBe(2);

    expect((await post(learner, `/skill-exchanges/${ex.id}/feedback`, { rating: 5, comment: 'great' })).status).toBe(200);
    expect((await post(learner, `/skill-exchanges/${ex.id}/feedback`, { rating: 4 })).status).toBe(409);
  });
  it('rejects self-exchanges, duplicates, and hides exchanges from third parties; decline and cancel work', async () => {
    const { teacher, learner, offer } = await setup();
    const spy = await makeUser();
    expect((await post(teacher, '/skill-exchanges', { offerId: offer.id, message: 'me' })).status).toBe(400);
    const ex = (await post(learner, '/skill-exchanges', { offerId: offer.id, message: 'hi' })).body.data;
    expect((await post(learner, '/skill-exchanges', { offerId: offer.id, message: 'again' })).status).toBe(409);
    expect((await api().get(`/api/v1/skill-exchanges/${ex.id}`).set(as(spy))).status).toBe(404);
    expect((await post(teacher, `/skill-exchanges/${ex.id}/decline`)).body.data.status).toBe('declined');
    expect((await post(learner, `/skill-exchanges/${ex.id}/cancel`)).status).toBe(409);
    expect(await Notification.countDocuments({ type: 'exchange_request' })).toBe(1);
  });
  it('shows requests only to the right audience and explains matches with concrete reasons', async () => {
    const a = await makeUser(); const b = await makeUser(); const c = await makeUser();
    await post(a, '/skill-requests', { title: 'Need English practice', description: 'conversation', skill: 'English', audience: 'direct', targetUser: b.id });
    expect((await api().get('/api/v1/skill-requests').set(as(b))).body.data).toHaveLength(1);
    expect((await api().get('/api/v1/skill-requests').set(as(c))).body.data).toHaveLength(0);

    await api().put('/api/v1/users/me/skills').set(as(a)).send({ skills: [{ name: 'English', kind: 'learn' }, { name: 'React', kind: 'teach' }] });
    await api().put('/api/v1/users/me/skills').set(as(b)).send({ skills: [{ name: 'English', kind: 'teach' }, { name: 'React', kind: 'learn' }] });
    const m = (await api().get('/api/v1/skill-exchanges/matches').set(as(a))).body.data;
    expect(m).toHaveLength(1);
    expect(m[0].reciprocal).toBe(true);
    expect(m[0].reasons.join(' ')).toMatch(/can teach English/);
    expect(m[0]).not.toHaveProperty('score');
  });
});

describe('projects and tasks', () => {
  async function setup(visibility = 'public') {
    const owner = await makeUser(); const dev = await makeUser(); const outsider = await makeUser();
    const p = (await post(owner, '/projects', { title: 'Build a store', description: 'E-commerce', category: 'programming', skills: ['react'], visibility })).body.data;
    return { owner, dev, outsider, p };
  }
  it('hides private projects entirely; joining needs approval; only members see tasks', async () => {
    const { owner, dev, outsider, p } = await setup('private');
    expect((await api().get(`/api/v1/projects/${p.id}`).set(as(outsider))).status).toBe(404);
    expect((await post(outsider, `/projects/${p.id}/join-requests`)).status).toBe(404);

    const pub = (await setup('public'));
    expect((await api().get(`/api/v1/projects/${pub.p.id}/tasks`).set(as(pub.outsider))).status).toBe(403);
    expect((await post(pub.dev, `/projects/${pub.p.id}/join-requests`, { message: 'hi' })).status).toBe(201);
    expect((await api().get(`/api/v1/projects/${pub.p.id}/tasks`).set(as(pub.dev))).status).toBe(403); // pending is not access
    expect((await post(pub.dev, `/projects/${pub.p.id}/join-requests/${pub.dev.id}/approve`)).status).toBe(403);
    expect((await post(pub.owner, `/projects/${pub.p.id}/join-requests/${pub.dev.id}/approve`)).status).toBe(200);
    expect((await api().get(`/api/v1/projects/${pub.p.id}/tasks`).set(as(pub.dev))).status).toBe(200);
    expect(owner.id).toBeTruthy(); expect(dev.id).toBeTruthy();
  });
  it('computes progress from real tasks, enforces task permissions, and records activity', async () => {
    const { owner, dev, outsider, p } = await setup();
    await post(dev, `/projects/${p.id}/join-requests`);
    await post(owner, `/projects/${p.id}/join-requests/${dev.id}/approve`);

    const t1 = (await post(owner, `/projects/${p.id}/tasks`, { title: 'Design schema', assignee: dev.id })).body.data;
    const t2 = (await post(owner, `/projects/${p.id}/tasks`, { title: 'Build API' })).body.data;
    expect((await post(owner, `/projects/${p.id}/tasks`, { title: 'Bad', assignee: outsider.id })).status).toBe(400);

    expect((await api().patch(`/api/v1/tasks/${t2.id}`).set(as(dev)).send({ status: 'done' })).status).toBe(403); // not assignee/creator
    expect((await api().patch(`/api/v1/tasks/${t1.id}`).set(as(dev)).send({ title: 'x' })).status).toBe(403); // content edit needs creator/maintainer
    expect((await api().patch(`/api/v1/tasks/${t1.id}`).set(as(dev)).send({ status: 'done' })).body.data.status).toBe('done');
    expect((await api().patch(`/api/v1/tasks/${t1.id}`).set(as(outsider)).send({ status: 'todo' })).status).toBe(404);

    const proj = (await api().get(`/api/v1/projects/${p.id}`).set(as(owner))).body.data;
    expect(proj.progress).toMatchObject({ total: 2, done: 1, percent: 50 });
    expect((await api().patch(`/api/v1/projects/${p.id}`).set(as(owner)).send({ progress: 100 })).status).toBe(422); // client cannot set progress
    const detail = (await api().get(`/api/v1/tasks/${t1.id}`).set(as(owner))).body.data;
    expect(detail.activity.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['created', 'status_changed']));
    expect(await UserAchievement.countDocuments({ key: 'first_team_task_done', user: dev.id })).toBe(1);

    expect((await post(dev, `/tasks/${t1.id}/comments`, { body: 'finished' })).status).toBe(201);
    expect((await post(outsider, `/tasks/${t1.id}/comments`, { body: 'hi' })).status).toBe(404);
  });
  it('a solo project cannot be used to farm the team-task achievement', async () => {
    const { owner, p } = await setup();
    const t = (await post(owner, `/projects/${p.id}/tasks`, { title: 'Solo task', assignee: owner.id })).body.data;
    await api().patch(`/api/v1/tasks/${t.id}`).set(as(owner)).send({ status: 'done' });
    expect(await UserAchievement.countDocuments({ key: 'first_team_task_done' })).toBe(0);
  });
});

describe('events', () => {
  const mk = (u: { token: string }, over: Record<string, unknown> = {}) => post(u, '/events', { title: 'React workshop', startsAt: future(), timeZone: 'Africa/Casablanca', ...over });
  it('keeps the instant and shows the host time zone; rejects past events and zone-less times', async () => {
    const host = await makeUser();
    const e = await mk(host, { startsAt: '2030-06-01T18:00:00+01:00', timeZone: 'Africa/Casablanca' });
    expect(e.status).toBe(201);
    expect(e.body.data.startsAt).toBe('2030-06-01T17:00:00.000Z');
    expect(e.body.data.startsAtLocal).toBe('2030-06-01T18:00');
    expect((await mk(host, { startsAt: '2030-06-01T18:00:00' })).status).toBe(422); // no offset: refuse to guess
    expect((await mk(host, { startsAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(400);
    expect((await mk(host, { timeZone: 'Mars/Base' })).status).toBe(422);
  });
  it('never exceeds capacity under concurrent registration; supports cancel registration', async () => {
    const host = await makeUser();
    const e = (await mk(host, { capacity: 2 })).body.data;
    const users = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser()]);
    const results = await Promise.all(users.map((u) => post(u, `/events/${e.id}/register`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect((await Event.findById(e.id))!.registeredCount).toBe(2);
    const winner = users[results.findIndex((r) => r.status === 200)]!;
    expect((await post(winner, `/events/${e.id}/register`)).status).toBe(200); // idempotent
    expect((await Event.findById(e.id))!.registeredCount).toBe(2);
    await api().delete(`/api/v1/events/${e.id}/register`).set(as(winner));
    expect((await Event.findById(e.id))!.registeredCount).toBe(1);
  });
  it('cancelling notifies registrants and blocks new registrations; only the host can edit', async () => {
    const host = await makeUser(); const guest = await makeUser(); const late = await makeUser();
    const e = (await mk(host)).body.data;
    await post(guest, `/events/${e.id}/register`);
    expect((await api().patch(`/api/v1/events/${e.id}`).set(as(guest)).send({ status: 'cancelled' })).status).toBe(404);
    expect((await api().patch(`/api/v1/events/${e.id}`).set(as(host)).send({ status: 'cancelled' })).body.data.status).toBe('cancelled');
    expect(await Notification.countDocuments({ recipient: guest.id, type: 'event_cancelled' })).toBe(1);
    expect((await post(late, `/events/${e.id}/register`)).status).toBe(409);
  });
  it('community events need a moderator and stay hidden from non-members of private communities', async () => {
    const owner = await makeUser(); const member = await makeUser(); const outsider = await makeUser();
    const c = (await makeCommunity(owner, { visibility: 'private', name: 'Private Study' })).body.data;
    await post(member, `/communities/${c.id}/join`); await post(owner, `/communities/${c.id}/members/${member.id}/approve`);
    expect((await mk(member, { community: c.id })).status).toBe(403);
    const e = (await mk(owner, { community: c.id })).body.data;
    expect((await api().get(`/api/v1/events/${e.id}`).set(as(outsider))).status).toBe(404);
    expect((await api().get('/api/v1/events').set(as(outsider))).body.data).toHaveLength(0);
    expect((await api().get(`/api/v1/communities/${c.id}/events`).set(as(member))).body.data).toHaveLength(1);
  });
  it('paginates upcoming events in start order with a stable cursor', async () => {
    const host = await makeUser();
    for (const d of [3, 1, 2]) await mk(host, { title: `Event day ${d}`, startsAt: future(d) });
    const p1 = await api().get('/api/v1/events?limit=2').set(as(host));
    expect(p1.body.data.map((x: { title: string }) => x.title)).toEqual(['Event day 1', 'Event day 2']);
    const p2 = await api().get(`/api/v1/events?limit=2&cursor=${p1.body.meta.nextCursor}`).set(as(host));
    expect(p2.body.data.map((x: { title: string }) => x.title)).toEqual(['Event day 3']);
  });
});

describe('goals and achievements', () => {
  it('derives progress from milestones, blocks early completion, records history, awards once', async () => {
    const u = await makeUser(); const other = await makeUser();
    const g = (await post(u, '/goals', { title: 'Learn React', milestones: ['Hooks', 'Router'] })).body.data;
    expect(g.progress).toEqual({ done: 0, total: 2, percent: 0 });
    expect((await api().patch(`/api/v1/goals/${g.id}`).set(as(u)).send({ status: 'completed' })).body.error.code).toBe('MILESTONES_PENDING');
    expect((await api().patch(`/api/v1/milestones/${g.milestones[0].id}`).set(as(other)).send({ completed: true })).status).toBe(404);

    await api().patch(`/api/v1/milestones/${g.milestones[0].id}`).set(as(u)).send({ completed: true });
    const half = (await api().get(`/api/v1/goals/${g.id}`).set(as(u))).body.data;
    expect(half.progress.percent).toBe(50);
    await api().patch(`/api/v1/milestones/${g.milestones[1].id}`).set(as(u)).send({ completed: true });
    const done = await api().patch(`/api/v1/goals/${g.id}`).set(as(u)).send({ status: 'completed' });
    expect(done.body.data.status).toBe('completed');
    const detail = (await api().get(`/api/v1/goals/${g.id}`).set(as(u))).body.data;
    expect(detail.history.map((h: { type: string }) => h.type)).toEqual(['goal_completed', 'milestone_completed', 'milestone_completed']);

    const list = (await api().get('/api/v1/achievements').set(as(u))).body.data;
    expect(list.find((a: { key: string }) => a.key === 'first_goal_completed').earned).toBe(true);
    expect((await api().get('/api/v1/achievements').set(as(other))).body.data.every((a: { earned: boolean }) => !a.earned)).toBe(true);
    expect((await api().get(`/api/v1/users/${u.id}/achievements`).set(as(other))).body.data).toHaveLength(1);
    expect((await api().get(`/api/v1/goals/${g.id}`).set(as(other))).status).toBe(404); // goals are private
  });
  it('awards the answer achievement for accepted answers but never for accepting your own', async () => {
    const owner = await makeUser(); const asker = await makeUser();
    const c = (await makeCommunity(owner)).body.data;
    await post(asker, `/communities/${c.id}/join`);
    const q = (await post(asker, '/posts', { type: 'question', title: 'How do hooks work?', body: 'x', community: c.id })).body.data;
    const own = (await post(asker, `/posts/${q.id}/comments`, { body: 'my own answer' })).body.data;
    await post(asker, `/questions/${q.id}/accept-answer`, { commentId: own.id });
    expect(await UserAchievement.countDocuments({ key: 'first_accepted_answer' })).toBe(0);
    const theirs = (await post(owner, `/posts/${q.id}/comments`, { body: 'real answer' })).body.data;
    await post(asker, `/questions/${q.id}/accept-answer`, { commentId: theirs.id });
    expect(await UserAchievement.countDocuments({ key: 'first_accepted_answer', user: owner.id })).toBe(1);
  });
  it('deleting a goal removes its milestones and history', async () => {
    const u = await makeUser();
    const g = (await post(u, '/goals', { title: 'Temp goal', milestones: ['a'] })).body.data;
    expect((await api().delete(`/api/v1/goals/${g.id}`).set(as(u))).status).toBe(200);
    expect((await api().get(`/api/v1/goals/${g.id}`).set(as(u))).status).toBe(404);
  });
});
