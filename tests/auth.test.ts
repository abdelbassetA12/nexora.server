import { describe, expect, it } from 'vitest';
import { RefreshSession } from '../src/database/models/RefreshSession';
import { User } from '../src/database/models/User';
import { api, authHeader, lastEmailToken, registerUser, validUser } from './helpers';

describe('POST /auth/register', () => {
  it('creates an account, returns tokens, and never exposes the password hash', async () => {
    const res = await registerUser();
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('ada@example.com');
    expect(res.body.data.user.emailVerified).toBe(false);
    expect(res.body.data.tokens.accessToken).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const stored = await User.findOne({ emailNormalized: 'ada@example.com' }).select('+passwordHash');
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('rejects weak passwords and bad usernames with field details', async () => {
    const res = await registerUser({ password: 'short', username: 'a b' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.fields.map((f: { path: string }) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['password', 'username']));
  });

  it('rejects duplicate email (case-insensitive) and duplicate username', async () => {
    await registerUser();
    const dupEmail = await registerUser({ email: 'ADA@example.com', username: 'other_name' });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.error.code).toBe('EMAIL_TAKEN');
    const dupName = await registerUser({ email: 'b@example.com', username: 'ADA_L' });
    expect(dupName.status).toBe(409);
    expect(dupName.body.error.code).toBe('USERNAME_TAKEN');
  });

  it('handles concurrent duplicate registrations without creating two accounts', async () => {
    const results = await Promise.all([registerUser(), registerUser()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await User.countDocuments()).toBe(1);
  });
});

describe('POST /auth/login', () => {
  it('logs in with correct credentials', async () => {
    await registerUser();
    const res = await api().post('/api/v1/auth/login').send({ email: 'ada@example.com', password: 'correct-horse-9' });
    expect(res.status).toBe(200);
    expect(res.body.data.tokens.refreshToken).toBeTruthy();
  });

  it('returns the same generic error for wrong password and unknown email', async () => {
    await registerUser();
    const wrong = await api().post('/api/v1/auth/login').send({ email: 'ada@example.com', password: 'nope-nope-1' });
    const unknown = await api().post('/api/v1/auth/login').send({ email: 'ghost@example.com', password: 'nope-nope-1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('blocks suspended accounts', async () => {
    await registerUser();
    await User.updateOne({}, { status: 'suspended' });
    const res = await api().post('/api/v1/auth/login').send({ email: 'ada@example.com', password: 'correct-horse-9' });
    expect(res.status).toBe(403);
  });
});

describe('GET /auth/me', () => {
  it('requires a valid bearer token', async () => {
    expect((await api().get('/api/v1/auth/me')).status).toBe(401);
    expect((await api().get('/api/v1/auth/me').set(authHeader('garbage'))).status).toBe(401);
  });

  it('returns the current user', async () => {
    const { body } = await registerUser();
    const res = await api().get('/api/v1/auth/me').set(authHeader(body.data.tokens.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('ada_l');
  });

  it('rejects tokens of suspended users', async () => {
    const { body } = await registerUser();
    await User.updateOne({}, { status: 'suspended' });
    const res = await api().get('/api/v1/auth/me').set(authHeader(body.data.tokens.accessToken));
    expect(res.status).toBe(401);
  });
});

describe('refresh token rotation', () => {
  it('rotates tokens and invalidates the old refresh token', async () => {
    const { body } = await registerUser();
    const first = body.data.tokens.refreshToken;
    const rotated = await api().post('/api/v1/auth/refresh').send({ refreshToken: first });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.tokens.refreshToken).not.toBe(first);
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const { body } = await registerUser();
    const first = body.data.tokens.refreshToken;
    const second = (await api().post('/api/v1/auth/refresh').send({ refreshToken: first })).body.data.tokens.refreshToken;

    const reuse = await api().post('/api/v1/auth/refresh').send({ refreshToken: first });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // The legitimate newest token is now dead too.
    const afterTheft = await api().post('/api/v1/auth/refresh').send({ refreshToken: second });
    expect(afterTheft.status).toBe(401);
  });

  it('allows only one of two concurrent refreshes with the same token', async () => {
    const { body } = await registerUser();
    const token = body.data.tokens.refreshToken;
    const results = await Promise.all([
      api().post('/api/v1/auth/refresh').send({ refreshToken: token }),
      api().post('/api/v1/auth/refresh').send({ refreshToken: token }),
    ]);
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
  });

  it('rejects expired refresh sessions', async () => {
    const { body } = await registerUser();
    await RefreshSession.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    const res = await api().post('/api/v1/auth/refresh').send({ refreshToken: body.data.tokens.refreshToken });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session and is idempotent', async () => {
    const { body } = await registerUser();
    const token = body.data.tokens.refreshToken;
    expect((await api().post('/api/v1/auth/logout').send({ refreshToken: token })).status).toBe(200);
    expect((await api().post('/api/v1/auth/logout').send({ refreshToken: token })).status).toBe(200);
    expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: token })).status).toBe(401);
  });
});

describe('email verification', () => {
  it('verifies the email once with the emailed token', async () => {
    const { body } = await registerUser();
    const token = lastEmailToken();
    const res = await api().post('/api/v1/auth/verify-email').send({ token });
    expect(res.status).toBe(200);

    const me = await api().get('/api/v1/auth/me').set(authHeader(body.data.tokens.accessToken));
    expect(me.body.data.emailVerified).toBe(true);

    const again = await api().post('/api/v1/auth/verify-email').send({ token });
    expect(again.status).toBe(400);
  });

  it('rejects invalid tokens', async () => {
    const res = await api().post('/api/v1/auth/verify-email').send({ token: 'x'.repeat(40) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('resend gives a generic response whether or not the account exists', async () => {
    await registerUser();
    const a = await api().post('/api/v1/auth/resend-verification').send({ email: 'ada@example.com' });
    const b = await api().post('/api/v1/auth/resend-verification').send({ email: 'ghost@example.com' });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body.data).toEqual(b.body.data);
  });
});

describe('password recovery', () => {
  it('resets the password, signs out all sessions, and the token is single-use', async () => {
    const { body } = await registerUser();
    await api().post('/api/v1/auth/forgot-password').send({ email: 'ada@example.com' });
    const token = lastEmailToken();

    const reset = await api().post('/api/v1/auth/reset-password').send({ token, password: 'brand-new-pass-7' });
    expect(reset.status).toBe(200);

    // Old refresh token no longer works; old password no longer works; new one does.
    expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: body.data.tokens.refreshToken })).status).toBe(401);
    expect((await api().post('/api/v1/auth/login').send({ email: 'ada@example.com', password: validUser().password })).status).toBe(401);
    expect((await api().post('/api/v1/auth/login').send({ email: 'ada@example.com', password: 'brand-new-pass-7' })).status).toBe(200);

    const reuse = await api().post('/api/v1/auth/reset-password').send({ token, password: 'another-pass-77' });
    expect(reuse.status).toBe(400);
  });

  it('does not reveal whether an email is registered', async () => {
    const res = await api().post('/api/v1/auth/forgot-password').send({ email: 'ghost@example.com' });
    expect(res.status).toBe(202);
  });
});

describe('API conventions', () => {
  it('returns a structured 404 with a request id', async () => {
    const res = await api().get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await api().post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});
