import { describe, expect, it } from 'vitest';
import { Community } from '../src/database/models/Community';
import { CommunityMembership } from '../src/database/models/CommunityMembership';
import { api, as, makeCommunity, makeUser } from './helpers';

describe('community creation', () => {
  it('requires a verified email', async () => {
    const u = await makeUser('unverified', false);
    const res = await makeCommunity(u);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('creates a community with the creator as owner and a derived slug', async () => {
    const u = await makeUser();
    const res = await makeCommunity(u);
    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe('react-developers');
    expect(res.body.data.myMembership).toEqual({ role: 'owner', status: 'active' });
    expect(res.body.data.memberCount).toBe(1);
  });

  it('rejects duplicate explicit slugs and invalid input', async () => {
    const u = await makeUser();
    await makeCommunity(u, { slug: 'react-hub' });
    const dup = await makeCommunity(u, { name: 'Another one', slug: 'react-hub' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SLUG_TAKEN');
    const bad = await makeCommunity(u, { name: 'x' });
    expect(bad.status).toBe(422);
  });
});

describe('membership', () => {
  it('lets a user join an open community once and keeps the counter correct', async () => {
    const owner = await makeUser();
    const joiner = await makeUser();
    const c = (await makeCommunity(owner)).body.data;

    const [a, b] = await Promise.all([
      api().post(`/api/v1/communities/${c.id}/join`).set(as(joiner)),
      api().post(`/api/v1/communities/${c.id}/join`).set(as(joiner)),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await CommunityMembership.countDocuments({ community: c.id, user: joiner.id })).toBe(1);
    expect((await Community.findById(c.id))!.memberCount).toBe(2);
  });

  it('puts approval-based and private joins in pending until approved', async () => {
    const owner = await makeUser();
    const joiner = await makeUser();
    const c = (await makeCommunity(owner, { joinPolicy: 'approval' })).body.data;

    const join = await api().post(`/api/v1/communities/${c.id}/join`).set(as(joiner));
    expect(join.body.data.status).toBe('pending');
    expect((await Community.findById(c.id))!.memberCount).toBe(1);

    // A non-moderator cannot approve.
    const other = await makeUser();
    expect((await api().post(`/api/v1/communities/${c.id}/members/${joiner.id}/approve`).set(as(other))).status).toBe(403);

    expect((await api().post(`/api/v1/communities/${c.id}/members/${joiner.id}/approve`).set(as(owner))).status).toBe(200);
    expect((await Community.findById(c.id))!.memberCount).toBe(2);
    // Approving twice fails: no pending request remains.
    expect((await api().post(`/api/v1/communities/${c.id}/members/${joiner.id}/approve`).set(as(owner))).status).toBe(404);
  });

  it('prevents the owner from leaving and lets members leave', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const c = (await makeCommunity(owner)).body.data;
    await api().post(`/api/v1/communities/${c.id}/join`).set(as(member));

    expect((await api().post(`/api/v1/communities/${c.id}/leave`).set(as(owner))).body.error.code).toBe('OWNER_CANNOT_LEAVE');
    expect((await api().post(`/api/v1/communities/${c.id}/leave`).set(as(member))).status).toBe(200);
    expect((await Community.findById(c.id))!.memberCount).toBe(1);
  });

  it('enforces roles: only owners change roles; moderators cannot ban; admins can', async () => {
    const owner = await makeUser();
    const mod = await makeUser();
    const admin = await makeUser();
    const target = await makeUser();
    const c = (await makeCommunity(owner)).body.data;
    for (const u of [mod, admin, target]) await api().post(`/api/v1/communities/${c.id}/join`).set(as(u));

    expect((await api().patch(`/api/v1/communities/${c.id}/members/${mod.id}/role`).set(as(admin)).send({ role: 'moderator' })).status).toBe(403);
    await api().patch(`/api/v1/communities/${c.id}/members/${mod.id}/role`).set(as(owner)).send({ role: 'moderator' });
    await api().patch(`/api/v1/communities/${c.id}/members/${admin.id}/role`).set(as(owner)).send({ role: 'admin' });

    expect((await api().post(`/api/v1/communities/${c.id}/members/${target.id}/ban`).set(as(mod))).status).toBe(403);
    expect((await api().post(`/api/v1/communities/${c.id}/members/${target.id}/ban`).set(as(admin))).status).toBe(200);

    // Banned users cannot rejoin.
    const rejoin = await api().post(`/api/v1/communities/${c.id}/join`).set(as(target));
    expect(rejoin.status).toBe(403);
    expect(rejoin.body.error.code).toBe('BANNED');
    // Admins cannot ban the owner.
    expect((await api().post(`/api/v1/communities/${c.id}/members/${owner.id}/ban`).set(as(admin))).status).toBe(403);
  });

  it('only admins can edit community settings', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const c = (await makeCommunity(owner)).body.data;
    await api().post(`/api/v1/communities/${c.id}/join`).set(as(member));
    expect((await api().patch(`/api/v1/communities/${c.id}`).set(as(member)).send({ description: 'hacked' })).status).toBe(403);
    const ok = await api().patch(`/api/v1/communities/${c.id}`).set(as(owner)).send({ description: 'Updated' });
    expect(ok.body.data.description).toBe('Updated');
  });
});

describe('private communities', () => {
  it('hide members, posts and rules from non-members and are not listed publicly', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const c = (await makeCommunity(owner, { visibility: 'private', rules: ['Be kind'], name: 'Secret Club' })).body.data;

    const detail = await api().get(`/api/v1/communities/${c.id}`).set(as(outsider));
    expect(detail.status).toBe(200);
    expect(detail.body.data.rules).toEqual([]);
    expect((await api().get(`/api/v1/communities/${c.id}/members`).set(as(outsider))).status).toBe(403);
    expect((await api().get(`/api/v1/communities/${c.id}/posts`).set(as(outsider))).status).toBe(403);

    const list = await api().get('/api/v1/communities').set(as(outsider));
    expect(list.body.data.find((x: { id: string }) => x.id === c.id)).toBeUndefined();

    // Joining a private community only creates a request.
    expect((await api().post(`/api/v1/communities/${c.id}/join`).set(as(outsider))).body.data.status).toBe('pending');
    expect((await api().get(`/api/v1/communities/${c.id}/posts`).set(as(outsider))).status).toBe(403);
  });
});

describe('listing', () => {
  it('paginates with cursors', async () => {
    const owner = await makeUser();
    for (let i = 0; i < 3; i++) await makeCommunity(owner, { name: `Community number ${i}` });
    const p1 = await api().get('/api/v1/communities?limit=2').set(as(owner));
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.meta.nextCursor).toBeTruthy();
    const p2 = await api().get(`/api/v1/communities?limit=2&cursor=${p1.body.meta.nextCursor}`).set(as(owner));
    expect(p2.body.data).toHaveLength(1);
    expect(p2.body.meta.nextCursor).toBeNull();
  });
});

describe('my communities', () => {
  it('lists active memberships including private communities, and no others', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    await makeCommunity(owner, { name: 'Public One' });
    await makeCommunity(owner, { name: 'Private One', visibility: 'private' });
    const mine = await api().get('/api/v1/communities/mine').set(as(owner));
    expect(mine.body.data.map((c: { name: string }) => c.name).sort()).toEqual(['Private One', 'Public One']);
    expect((await api().get('/api/v1/communities/mine').set(as(other))).body.data).toHaveLength(0);
  });
});
