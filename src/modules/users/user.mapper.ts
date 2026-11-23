import type { PrivateUser } from '../../shared/index';
import type { UserDoc } from '../../database/models/User';

export function toPrivateUser(u: UserDoc): PrivateUser {
  return {
    id: String(u._id),
    email: u.email,
    emailVerified: Boolean(u.emailVerifiedAt),
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl ?? null,
    bio: u.bio ?? '',
    country: u.country ?? null,
    languages: [...(u.languages ?? [])],
    locale: u.locale as 'en' | 'ar',
    interests: [...(u.interests ?? [])],
    goals: [...(u.goals ?? [])],
    onboarding: { step: u.onboarding?.step ?? 0, completed: Boolean(u.onboarding?.completed) },
    role: u.role as PrivateUser['role'],
    createdAt: u.createdAt.toISOString(),
  };
}
