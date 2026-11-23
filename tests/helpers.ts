import request from 'supertest';
import { createApp } from '../src/app';
import { getEmailProvider, MemoryEmailProvider } from '../src/integrations/email';

export const app = createApp();
export const api = () => request(app);

export const validUser = (over: Partial<Record<string, string>> = {}) => ({
  email: 'ada@example.com',
  password: 'correct-horse-9',
  username: 'ada_l',
  displayName: 'Ada Lovelace',
  ...over,
});

export async function registerUser(over: Partial<Record<string, string>> = {}) {
  const res = await api().post('/api/v1/auth/register').send(validUser(over));
  return res;
}

export const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

export function lastEmailToken(): string {
  const provider = getEmailProvider() as MemoryEmailProvider;
  const last = provider.sent[provider.sent.length - 1];
  if (!last) throw new Error('No email was sent');
  const match = /code: (\S+)/.exec(last.text);
  if (!match?.[1]) throw new Error('No token in email');
  return match[1];
}

let counter = 0;
/** Registers a user, marks the email verified directly in the DB, and returns credentials. */
export async function makeUser(name?: string, verified = true) {
  counter += 1;
  const handle = name ?? `user${counter}`;
  const res = await registerUser({ email: `${handle}@example.com`, username: handle, displayName: handle });
  const id = res.body.data.user.id as string;
  if (verified) {
    const { User } = await import('../src/database/models/User');
    await User.updateOne({ _id: id }, { emailVerifiedAt: new Date() });
  }
  return { id, token: res.body.data.tokens.accessToken as string, handle };
}

export const as = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

export async function makeCommunity(owner: { token: string }, over: Record<string, unknown> = {}) {
  const res = await api().post('/api/v1/communities').set(as(owner)).send({ name: 'React Developers', category: 'programming', ...over });
  return res;
}
