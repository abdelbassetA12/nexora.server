import { describe, expect, it } from 'vitest';
import { User } from '../src/database/models/User';
import { UserSkill } from '../src/database/models/UserSkill';
import { api, authHeader, registerUser } from './helpers';

async function signedIn(over: Partial<Record<string, string>> = {}) {
  const { body } = await registerUser(over);
  return { token: body.data.tokens.accessToken as string, id: body.data.user.id as string };
}

describe('PATCH /users/me', () => {
  it('requires authentication', async () => {
    expect((await api().patch('/api/v1/users/me').send({ bio: 'x' })).status).toBe(401);
  });

  it('updates onboarding data and normalizes interests', async () => {
    const { token } = await signedIn();
    const res = await api()
      .patch('/api/v1/users/me')
      .set(authHeader(token))
      .send({ interests: ['Programming', 'Trading & Finance', 'programming'], goals: ['complete_project'], onboarding: { step: 3, completed: false }, locale: 'ar' });
    expect(res.status).toBe(200);
    expect(res.body.data.interests).toEqual(['programming', 'trading-finance']);
    expect(res.body.data.locale).toBe('ar');
    expect(res.body.data.onboarding.step).toBe(3);
  });

  it('ignores privileged fields such as role and status', async () => {
    const { token, id } = await signedIn();
    const res = await api().patch('/api/v1/users/me').set(authHeader(token)).send({ bio: 'hi', role: 'admin', status: 'active', emailVerifiedAt: new Date() });
    expect(res.status).toBe(200);
    const stored = await User.findById(id).lean();
    expect(stored?.role).toBe('user');
    expect(stored?.emailVerifiedAt).toBeNull();
  });

  it('rejects an empty update and invalid values', async () => {
    const { token } = await signedIn();
    expect((await api().patch('/api/v1/users/me').set(authHeader(token)).send({})).status).toBe(422);
    expect((await api().patch('/api/v1/users/me').set(authHeader(token)).send({ locale: 'xx' })).status).toBe(422);
  });

  it('prevents taking another user\'s username', async () => {
    await signedIn();
    const { token } = await signedIn({ email: 'b@example.com', username: 'bob_b' });
    const res = await api().patch('/api/v1/users/me').set(authHeader(token)).send({ username: 'ADA_L' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USERNAME_TAKEN');
  });
});

describe('skills', () => {
  it('replaces the full skill set, deduplicating and removing stale entries', async () => {
    const { token, id } = await signedIn();
    const put = (skills: unknown[]) => api().put('/api/v1/users/me/skills').set(authHeader(token)).send({ skills });

    const first = await put([
      { name: 'React', kind: 'teach', level: 'advanced' },
      { name: 'react', kind: 'teach', level: 'expert' },
      { name: 'English', kind: 'learn' },
    ]);
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(2);

    const second = await put([{ name: 'English', kind: 'learn', level: 'intermediate' }]);
    expect(second.body.data).toEqual([{ name: 'English', kind: 'learn', level: 'intermediate' }]);
    expect(await UserSkill.countDocuments({ user: id })).toBe(1);

    const cleared = await put([]);
    expect(cleared.body.data).toEqual([]);
  });
});

describe('GET /users/:username', () => {
  it('returns a public profile without private fields', async () => {
    const { token } = await signedIn();
    const res = await api().get('/api/v1/users/ADA_L').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('ada_l');
    expect(res.body.data).not.toHaveProperty('email');
    expect(res.body.data).not.toHaveProperty('privacy');
  });

  it('404s for unknown or suspended users', async () => {
    const { token } = await signedIn();
    expect((await api().get('/api/v1/users/ghost_user').set(authHeader(token))).status).toBe(404);
    await signedIn({ email: 'b@example.com', username: 'bob_b' });
    await User.updateOne({ usernameNormalized: 'bob_b' }, { status: 'suspended' });
    expect((await api().get('/api/v1/users/bob_b').set(authHeader(token))).status).toBe(404);
  });
});
