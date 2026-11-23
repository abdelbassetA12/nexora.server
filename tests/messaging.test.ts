import { describe, expect, it } from 'vitest';
import { Conversation } from '../src/database/models/Conversation';
import { Message } from '../src/database/models/Message';
import { User } from '../src/database/models/User';
import { api, as, makeUser } from './helpers';

const direct = (a: { token: string }, userId: string) => api().post('/api/v1/conversations').set(as(a)).send({ type: 'direct', userId });
const send = (u: { token: string }, convId: string, body: string, clientMsgId = `cid-${Math.random().toString(36).slice(2, 12)}`) =>
  api().post(`/api/v1/conversations/${convId}/messages`).set(as(u)).send({ body, clientMsgId });

describe('creating conversations', () => {
  it('creates one direct conversation per pair, even when created concurrently or by either side', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const results = await Promise.all([direct(a, b.id), direct(b, a.id), direct(a, b.id)]);
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
    expect(await Conversation.countDocuments({})).toBe(1);
    expect(results[0]!.body.data.title).toBe(b.handle);
  });

  it('rejects self-messaging, blocked users and users who disallow DMs', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    expect((await direct(a, a.id)).status).toBe(400);

    await User.updateOne({ _id: b.id }, { 'privacy.dmPermission': 'nobody' });
    expect((await direct(a, b.id)).status).toBe(403);

    await User.updateOne({ _id: b.id }, { 'privacy.dmPermission': 'following' });
    expect((await direct(a, b.id)).status).toBe(403);
    await api().post(`/api/v1/users/${a.id}/follow`).set(as(b));
    expect((await direct(a, b.id)).status).toBe(201);

    await api().post(`/api/v1/users/${c.id}/block`).set(as(a));
    expect((await direct(a, c.id)).status).toBe(403);
    expect((await direct(c, a.id)).status).toBe(403);
  });

  it('creates group conversations with a title and rejects invalid members', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    const res = await api().post('/api/v1/conversations').set(as(a)).send({ type: 'group', title: 'Study group', memberIds: [b.id, c.id, a.id] });
    expect(res.status).toBe(201);
    expect(res.body.data.members).toHaveLength(3);
    expect(res.body.data.title).toBe('Study group');
    const bad = await api().post('/api/v1/conversations').set(as(a)).send({ type: 'group', title: 'x', memberIds: ['000000000000000000000000'] });
    expect(bad.status).toBe(404);
  });
});

describe('messages', () => {
  it('persists messages, lists them newest-first with cursors, and updates the conversation preview', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const conv = (await direct(a, b.id)).body.data;
    for (let i = 1; i <= 3; i++) await send(a, conv.id, `message ${i}`);

    const p1 = await api().get(`/api/v1/conversations/${conv.id}/messages?limit=2`).set(as(b));
    expect(p1.body.data.map((m: { body: string }) => m.body)).toEqual(['message 3', 'message 2']);
    const p2 = await api().get(`/api/v1/conversations/${conv.id}/messages?limit=2&cursor=${p1.body.meta.nextCursor}`).set(as(b));
    expect(p2.body.data.map((m: { body: string }) => m.body)).toEqual(['message 1']);
    expect(p2.body.meta.nextCursor).toBeNull();

    const list = await api().get('/api/v1/conversations').set(as(b));
    expect(list.body.data[0].lastMessage.preview).toBe('message 3');
    expect(list.body.data[0].unreadCount).toBe(3);
  });

  it('is idempotent for retried sends (same clientMsgId), including concurrent ones', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const conv = (await direct(a, b.id)).body.data;
    const results = await Promise.all([send(a, conv.id, 'once', 'client-id-0001'), send(a, conv.id, 'once', 'client-id-0001'), send(a, conv.id, 'once', 'client-id-0001')]);
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
    expect(await Message.countDocuments({})).toBe(1);
  });

  it('never lets non-members read, send, mark read, or learn that a conversation exists', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const spy = await makeUser();
    const conv = (await direct(a, b.id)).body.data;
    await send(a, conv.id, 'private talk');

    expect((await api().get(`/api/v1/conversations/${conv.id}`).set(as(spy))).status).toBe(404);
    expect((await api().get(`/api/v1/conversations/${conv.id}/messages`).set(as(spy))).status).toBe(404);
    expect((await send(spy, conv.id, 'hi')).status).toBe(404);
    expect((await api().post(`/api/v1/conversations/${conv.id}/read`).set(as(spy)).send({})).status).toBe(404);
    expect((await api().get('/api/v1/conversations').set(as(spy))).body.data).toHaveLength(0);
  });

  it('blocks sending after a block and validates input', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const conv = (await direct(a, b.id)).body.data;
    expect((await send(a, conv.id, '   ')).status).toBe(422);
    expect((await send(a, conv.id, 'x', 'short')).status).toBe(422);
    await api().post(`/api/v1/users/${a.id}/block`).set(as(b));
    expect((await send(a, conv.id, 'still there?')).status).toBe(403);
  });

  it('tracks read state and unread counts, and never moves the marker backwards', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const conv = (await direct(a, b.id)).body.data;
    const m1 = (await send(a, conv.id, 'one')).body.data;
    const m2 = (await send(a, conv.id, 'two')).body.data;

    await api().post(`/api/v1/conversations/${conv.id}/read`).set(as(b)).send({ messageId: m2.id });
    expect((await api().get(`/api/v1/conversations/${conv.id}`).set(as(b))).body.data.unreadCount).toBe(0);
    const back = await api().post(`/api/v1/conversations/${conv.id}/read`).set(as(b)).send({ messageId: m1.id });
    expect(back.body.data.lastReadMessageId).toBe(m2.id);
    // The sender's own messages never count as unread for the sender.
    expect((await api().get(`/api/v1/conversations/${conv.id}`).set(as(a))).body.data.unreadCount).toBe(0);
  });

  it('syncs missed messages with ?after=', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const conv = (await direct(a, b.id)).body.data;
    const first = (await send(a, conv.id, 'seen')).body.data;
    await send(a, conv.id, 'missed 1');
    await send(a, conv.id, 'missed 2');
    const sync = await api().get(`/api/v1/conversations/${conv.id}/messages?after=${first.id}`).set(as(b));
    expect(sync.body.data.map((m: { body: string }) => m.body)).toEqual(['missed 1', 'missed 2']);
  });

  it('lets only the sender edit (within the window) and delete; deleted bodies are hidden', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const conv = (await direct(a, b.id)).body.data;
    const m = (await send(a, conv.id, 'oops')).body.data;
    expect((await api().patch(`/api/v1/messages/${m.id}`).set(as(b)).send({ body: 'x' })).status).toBe(404);
    expect((await api().patch(`/api/v1/messages/${m.id}`).set(as(a)).send({ body: 'fixed' })).body.data.body).toBe('fixed');
    await Message.updateOne({ _id: m.id }, { createdAt: new Date(Date.now() - 3_600_000) });
    expect((await api().patch(`/api/v1/messages/${m.id}`).set(as(a)).send({ body: 'late' })).status).toBe(409);
    expect((await api().delete(`/api/v1/messages/${m.id}`).set(as(b))).status).toBe(404);
    expect((await api().delete(`/api/v1/messages/${m.id}`).set(as(a))).status).toBe(200);
    const list = await api().get(`/api/v1/conversations/${conv.id}/messages`).set(as(b));
    expect(list.body.data[0]).toMatchObject({ deleted: true, body: '' });
  });

  it('supports replies, muting and leaving groups with ownership transfer', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const conv = (await api().post('/api/v1/conversations').set(as(a)).send({ type: 'group', title: 'Team', memberIds: [b.id] })).body.data;
    const m = (await send(a, conv.id, 'question?')).body.data;
    const reply = await api().post(`/api/v1/conversations/${conv.id}/messages`).set(as(b)).send({ body: 'answer', clientMsgId: 'reply-id-0001', replyTo: m.id });
    expect(reply.body.data.replyTo.id).toBe(m.id);

    expect((await api().post(`/api/v1/conversations/${conv.id}/mute`).set(as(b)).send({ muted: true })).body.data.muted).toBe(true);

    expect((await api().post(`/api/v1/conversations/${conv.id}/leave`).set(as(a))).status).toBe(200);
    expect((await api().get(`/api/v1/conversations/${conv.id}`).set(as(a))).status).toBe(404);
    const after = await api().get(`/api/v1/conversations/${conv.id}`).set(as(b));
    expect(after.body.data.members.find((x: { user: { id: string } }) => x.user.id === b.id).role).toBe('owner');

    const dm = (await direct(a, b.id)).body.data;
    expect((await api().post(`/api/v1/conversations/${dm.id}/leave`).set(as(a))).status).toBe(409);
  });
});
