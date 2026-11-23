import { describe, expect, it } from 'vitest';
import { Follow } from '../src/database/models/Follow';
import { Report } from '../src/database/models/Report';
import { api, as, makeCommunity, makeUser } from './helpers';

describe('follow and block', () => {
  it('follows idempotently, rejects self-follow, and blocking severs follows', async () => {
    const a = await makeUser();
    const b = await makeUser();
    expect((await api().post(`/api/v1/users/${a.id}/follow`).set(as(a))).status).toBe(400);
    await api().post(`/api/v1/users/${b.id}/follow`).set(as(a));
    await api().post(`/api/v1/users/${b.id}/follow`).set(as(a));
    expect(await Follow.countDocuments({})).toBe(1);

    await api().post(`/api/v1/users/${a.id}/block`).set(as(b));
    expect(await Follow.countDocuments({})).toBe(0);
    // Blocked pair cannot follow each other.
    expect((await api().post(`/api/v1/users/${b.id}/follow`).set(as(a))).status).toBe(403);
    await api().delete(`/api/v1/users/${a.id}/block`).set(as(b));
    expect((await api().post(`/api/v1/users/${b.id}/follow`).set(as(a))).status).toBe(200);
  });

  it('hides blocked users from search', async () => {
    const a = await makeUser('alice');
    const b = await makeUser('alicia');
    expect((await api().get('/api/v1/search/users?q=ali').set(as(a))).body.data.map((u: { username: string }) => u.username)).toEqual(['alicia']);
    await api().post(`/api/v1/users/${b.id}/block`).set(as(a));
    expect((await api().get('/api/v1/search/users?q=ali').set(as(a))).body.data).toHaveLength(0);
    expect((await api().get('/api/v1/search/users?q=ali').set(as(b))).body.data).toHaveLength(0);
  });
});

describe('reports', () => {
  it('persists a report once per target and returns the existing one on repeat', async () => {
    const owner = await makeUser();
    const author = await makeUser();
    const reporter = await makeUser();
    const c = (await makeCommunity(owner)).body.data;
    await api().post(`/api/v1/communities/${c.id}/join`).set(as(author));
    await api().post(`/api/v1/communities/${c.id}/join`).set(as(reporter));
    const p = (await api().post('/api/v1/posts').set(as(author)).send({ body: 'spammy post', community: c.id })).body.data;

    const body = { targetType: 'post', targetId: p.id, reason: 'spam' };
    const r1 = await api().post('/api/v1/reports').set(as(reporter)).send(body);
    const r2 = await api().post('/api/v1/reports').set(as(reporter)).send(body);
    expect(r1.status).toBe(201);
    expect(r2.body.data.id).toBe(r1.body.data.id);
    const stored = await Report.findOne({});
    expect(String(stored!.community)).toBe(c.id);
    expect(await Report.countDocuments({})).toBe(1);
  });

  it('rejects self-reports, unknown targets, and content the reporter cannot see', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const c = (await makeCommunity(owner, { visibility: 'private', name: 'Hidden Group' })).body.data;
    const p = (await api().post('/api/v1/posts').set(as(owner)).send({ body: 'private content', community: c.id })).body.data;

    expect((await api().post('/api/v1/reports').set(as(owner)).send({ targetType: 'post', targetId: p.id, reason: 'spam' })).status).toBe(400);
    expect((await api().post('/api/v1/reports').set(as(outsider)).send({ targetType: 'post', targetId: p.id, reason: 'spam' })).status).toBe(404);
    expect((await api().post('/api/v1/reports').set(as(outsider)).send({ targetType: 'user', targetId: outsider.id, reason: 'spam' })).status).toBe(400);
    expect((await api().post('/api/v1/reports').set(as(outsider)).send({ targetType: 'post', targetId: 'abc', reason: 'spam' })).status).toBe(422);
  });
});

describe('search', () => {
  it('finds public communities and posts and skills, never private ones', async () => {
    const owner = await makeUser();
    const viewer = await makeUser();
    await makeCommunity(owner, { name: 'TypeScript Wizards', description: 'Types for everyone' });
    await makeCommunity(owner, { name: 'Typed Secrets', visibility: 'private' });
    await api().put('/api/v1/users/me/skills').set(as(owner)).send({ skills: [{ name: 'TypeScript', kind: 'teach', level: 'advanced' }] });

    const all = await api().get('/api/v1/search?q=typescript').set(as(viewer));
    expect(all.body.data.communities.map((c: { name: string }) => c.name)).toEqual(['TypeScript Wizards']);
    expect(all.body.data.skills[0].selfDeclared).toBe(true);
    expect((await api().get('/api/v1/search/communities?q=typed').set(as(viewer))).body.data).toHaveLength(0);
    expect((await api().get('/api/v1/search?q=a').set(as(viewer))).status).toBe(422);
  });
});
