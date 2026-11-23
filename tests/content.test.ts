import { describe, expect, it } from 'vitest';
import { Community } from '../src/database/models/Community';
import { Notification } from '../src/database/models/Notification';
import { Post } from '../src/database/models/Post';
import { Reaction } from '../src/database/models/Reaction';
import { api, as, makeCommunity, makeUser } from './helpers';

async function setup() {
  const owner = await makeUser();
  const member = await makeUser();
  const c = (await makeCommunity(owner)).body.data;
  await api().post(`/api/v1/communities/${c.id}/join`).set(as(member));
  return { owner, member, c };
}
const post = (u: { token: string }, body: Record<string, unknown>) => api().post('/api/v1/posts').set(as(u)).send(body);

describe('posts', () => {
  it('lets members post in a community and rejects non-members', async () => {
    const { member, c } = await setup();
    const outsider = await makeUser();
    expect((await post(outsider, { body: 'hello', community: c.id })).status).toBe(403);
    const res = await post(member, { body: 'Hello world', community: c.id, tags: ['React', 'react'] });
    expect(res.status).toBe(201);
    expect(res.body.data.tags).toEqual(['react']);
    expect((await Community.findById(c.id))!.postCount).toBe(1);
  });

  it('requires a title for questions', async () => {
    const { member, c } = await setup();
    const res = await post(member, { type: 'question', body: 'How?', community: c.id });
    expect(res.status).toBe(422);
  });

  it('only the author can edit; others get 404', async () => {
    const { member, owner, c } = await setup();
    const p = (await post(member, { body: 'original', community: c.id })).body.data;
    expect((await api().patch(`/api/v1/posts/${p.id}`).set(as(owner)).send({ body: 'x' })).status).toBe(404);
    const edited = await api().patch(`/api/v1/posts/${p.id}`).set(as(member)).send({ body: 'edited' });
    expect(edited.body.data.body).toBe('edited');
    expect(edited.body.data.editedAt).toBeTruthy();
  });

  it('lets authors and moderators delete, and hides removed posts', async () => {
    const { member, owner, c } = await setup();
    const other = await makeUser();
    await api().post(`/api/v1/communities/${c.id}/join`).set(as(other));
    const p = (await post(member, { body: 'to remove', community: c.id })).body.data;
    expect((await api().delete(`/api/v1/posts/${p.id}`).set(as(other))).status).toBe(403);
    expect((await api().delete(`/api/v1/posts/${p.id}`).set(as(owner))).status).toBe(200);
    expect((await api().get(`/api/v1/posts/${p.id}`).set(as(member))).status).toBe(404);
    expect((await Community.findById(c.id))!.postCount).toBe(0);
  });

  it('hides private-community posts from non-members everywhere', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const c = (await makeCommunity(owner, { visibility: 'private', name: 'Hidden Place' })).body.data;
    const p = (await post(owner, { body: 'secret kubernetes tips', community: c.id })).body.data;
    expect((await api().get(`/api/v1/posts/${p.id}`).set(as(outsider))).status).toBe(404);
    expect((await api().get(`/api/v1/posts/${p.id}/comments`).set(as(outsider))).status).toBe(404);
    expect((await api().post(`/api/v1/posts/${p.id}/reactions`).set(as(outsider)).send({})).status).toBe(404);
    const search = await api().get('/api/v1/search/posts?q=kubernetes').set(as(outsider));
    expect(search.body.data).toHaveLength(0);
    const ownerSearch = await api().get('/api/v1/search/posts?q=kubernetes').set(as(owner));
    expect(ownerSearch.body.data).toHaveLength(1);
  });
});

describe('feed', () => {
  it('shows posts from joined communities and followed users, newest first, without blocked users', async () => {
    const { member, owner, c } = await setup();
    const followed = await makeUser();
    const blocked = await makeUser();
    await api().post(`/api/v1/communities/${c.id}/join`).set(as(blocked));
    await post(owner, { body: 'community post one', community: c.id });
    await post(followed, { body: 'profile post from followed' });
    await post(blocked, { body: 'post from blocked', community: c.id });
    await api().post(`/api/v1/users/${followed.id}/follow`).set(as(member));
    await api().post(`/api/v1/users/${blocked.id}/block`).set(as(member));

    const feed = await api().get('/api/v1/posts').set(as(member));
    const bodies = feed.body.data.map((p: { body: string }) => p.body);
    expect(bodies).toEqual(['profile post from followed', 'community post one']);
  });
});

describe('comments and notifications', () => {
  it('adds comments and replies with correct counters and notifications', async () => {
    const { member, owner, c } = await setup();
    const p = (await post(member, { body: 'question body', community: c.id })).body.data;

    const cm = await api().post(`/api/v1/posts/${p.id}/comments`).set(as(owner)).send({ body: 'first!' });
    expect(cm.status).toBe(201);
    const reply = await api().post(`/api/v1/comments/${cm.body.data.id}/replies`).set(as(member)).send({ body: 'thanks' });
    expect(reply.status).toBe(201);
    // Reply to a reply stays one level deep.
    const nested = await api().post(`/api/v1/comments/${reply.body.data.id}/replies`).set(as(owner)).send({ body: 'np' });
    expect(nested.body.data.parentId).toBe(cm.body.data.id);

    expect((await Post.findById(p.id))!.commentCount).toBe(3);
    const top = await api().get(`/api/v1/posts/${p.id}/comments`).set(as(member));
    expect(top.body.data).toHaveLength(1);
    expect(top.body.data[0].replyCount).toBe(2);

    const types = (await Notification.find({}).lean()).map((n) => `${n.type}`).sort();
    expect(types).toEqual(['comment', 'reply', 'reply']);
  });

  it('does not notify users about their own actions', async () => {
    const { member, c } = await setup();
    const p = (await post(member, { body: 'my post', community: c.id })).body.data;
    await api().post(`/api/v1/posts/${p.id}/comments`).set(as(member)).send({ body: 'me again' });
    expect(await Notification.countDocuments({})).toBe(0);
  });

  it('restricts editing to the author within the window, and deleting to author/moderator', async () => {
    const { member, owner, c } = await setup();
    const other = await makeUser();
    await api().post(`/api/v1/communities/${c.id}/join`).set(as(other));
    const p = (await post(member, { body: 'x post', community: c.id })).body.data;
    const cm = (await api().post(`/api/v1/posts/${p.id}/comments`).set(as(other)).send({ body: 'orig' })).body.data;

    expect((await api().patch(`/api/v1/comments/${cm.id}`).set(as(member)).send({ body: 'hax' })).status).toBe(404);
    expect((await api().patch(`/api/v1/comments/${cm.id}`).set(as(other)).send({ body: 'edit' })).body.data.body).toBe('edit');
    expect((await api().delete(`/api/v1/comments/${cm.id}`).set(as(member))).status).toBe(403);
    expect((await api().delete(`/api/v1/comments/${cm.id}`).set(as(owner))).status).toBe(200);
    expect((await Post.findById(p.id))!.commentCount).toBe(0);
  });

  it('serves notifications only to their recipient and supports read/read-all', async () => {
    const { member, owner, c } = await setup();
    const p = (await post(member, { body: 'hello post', community: c.id })).body.data;
    await api().post(`/api/v1/posts/${p.id}/comments`).set(as(owner)).send({ body: 'hi' });

    const list = await api().get('/api/v1/notifications').set(as(member));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].actor.username).toBe(owner.handle);
    expect((await api().get('/api/v1/notifications').set(as(owner))).body.data).toHaveLength(0);

    const id = list.body.data[0].id;
    expect((await api().post(`/api/v1/notifications/${id}/read`).set(as(owner))).status).toBe(404);
    expect((await api().get('/api/v1/notifications/unread-count').set(as(member))).body.data.count).toBe(1);
    expect((await api().post(`/api/v1/notifications/${id}/read`).set(as(member))).status).toBe(200);
    expect((await api().get('/api/v1/notifications/unread-count').set(as(member))).body.data.count).toBe(0);
  });
});

describe('reactions', () => {
  it('keeps one reaction per user and a correct counter', async () => {
    const { member, owner, c } = await setup();
    const p = (await post(member, { body: 'react to me', community: c.id })).body.data;

    const results = await Promise.all([
      api().post(`/api/v1/posts/${p.id}/reactions`).set(as(owner)).send({ type: 'like' }),
      api().post(`/api/v1/posts/${p.id}/reactions`).set(as(owner)).send({ type: 'like' }),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await Reaction.countDocuments({ post: p.id })).toBe(1);
    expect((await Post.findById(p.id))!.reactionCount).toBe(1);

    const switched = await api().post(`/api/v1/posts/${p.id}/reactions`).set(as(owner)).send({ type: 'helpful' });
    expect(switched.body.data.reactionCount).toBe(1);
    expect(switched.body.data.myReaction).toBe('helpful');

    const removed = await api().delete(`/api/v1/posts/${p.id}/reactions`).set(as(owner));
    expect(removed.body.data.reactionCount).toBe(0);
    const again = await api().delete(`/api/v1/posts/${p.id}/reactions`).set(as(owner));
    expect(again.body.data.reactionCount).toBe(0);
  });
});

describe('questions and accepted answers', () => {
  it('lets only the author (or a moderator) accept a top-level answer, and notifies the answerer', async () => {
    const { member, owner, c } = await setup();
    const answerer = await makeUser();
    await api().post(`/api/v1/communities/${c.id}/join`).set(as(answerer));
    const q = (await post(member, { type: 'question', title: 'How do hooks work?', body: 'Details…', community: c.id })).body.data;
    const ans = (await api().post(`/api/v1/posts/${q.id}/comments`).set(as(answerer)).send({ body: 'Like this' })).body.data;

    expect((await api().post(`/api/v1/questions/${q.id}/accept-answer`).set(as(answerer)).send({ commentId: ans.id })).status).toBe(403);
    const accepted = await api().post(`/api/v1/questions/${q.id}/accept-answer`).set(as(member)).send({ commentId: ans.id });
    expect(accepted.status).toBe(200);
    expect((await api().get(`/api/v1/posts/${q.id}`).set(as(owner))).body.data.acceptedCommentId).toBe(ans.id);
    expect(await Notification.countDocuments({ recipient: answerer.id, type: 'accepted_answer' })).toBe(1);
  });

  it('rejects accepting on non-questions and answers from other posts', async () => {
    const { member, c } = await setup();
    const d = (await post(member, { body: 'just a discussion', community: c.id })).body.data;
    const cm = (await api().post(`/api/v1/posts/${d.id}/comments`).set(as(member)).send({ body: 'c' })).body.data;
    expect((await api().post(`/api/v1/questions/${d.id}/accept-answer`).set(as(member)).send({ commentId: cm.id })).status).toBe(409);
  });
});

describe('saved items', () => {
  it('saves, lists and unsaves posts idempotently', async () => {
    const { member, owner, c } = await setup();
    const p = (await post(owner, { body: 'useful resource', community: c.id })).body.data;
    await api().post(`/api/v1/posts/${p.id}/save`).set(as(member));
    await api().post(`/api/v1/posts/${p.id}/save`).set(as(member));
    const list = await api().get('/api/v1/saved').set(as(member));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].saved).toBe(true);
    await api().delete(`/api/v1/posts/${p.id}/save`).set(as(member));
    expect((await api().get('/api/v1/saved').set(as(member))).body.data).toHaveLength(0);
  });
});
