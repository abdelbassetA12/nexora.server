// DEVELOPMENT ONLY. Creates clearly flagged sample data (isSeed) for local testing. Refuses to run in production.
import argon2 from 'argon2';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { ensureCatalog } from './catalog';
import { Community } from './models/Community';
import { CommunityMembership } from './models/CommunityMembership';
import { Event } from './models/Event';
import { Goal, GoalMilestone } from './models/Goal';
import { Post } from './models/Post';
import { Project, ProjectMembership, ProjectTask } from './models/Project';
import { SkillOffer } from './models/SkillOffer';
import { User } from './models/User';
import { UserSkill } from './models/UserSkill';

async function main() {
  if (env.isProd) throw new Error('Refusing to seed in production');
  await mongoose.connect(env.MONGODB_URI);
  await ensureCatalog();
  if (await User.exists({ isSeed: true })) { console.log('Seed data already exists. Drop the database to re-seed.'); return; }

  const password = crypto.randomBytes(9).toString('base64url'); // random per run, printed once; never a known default
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const people = [
    { u: 'sara_dev', n: 'Sara Dev', interests: ['programming', 'ai'], teach: ['React', 'TypeScript'], learn: ['English'], langs: ['en', 'ar'] },
    { u: 'omar_en', n: 'Omar English', interests: ['languages'], teach: ['English'], learn: ['React'], langs: ['en', 'ar'] },
    { u: 'lina_design', n: 'Lina Design', interests: ['design', 'freelancing'], teach: ['UI design'], learn: ['TypeScript'], langs: ['en'] },
    { u: 'yassine_trade', n: 'Yassine Trader', interests: ['trading-finance'], teach: ['Risk management'], learn: ['Excel'], langs: ['ar'] },
    { u: 'nora_pm', n: 'Nora PM', interests: ['business', 'career'], teach: ['Project management'], learn: ['React'], langs: ['en'] },
  ];
  const users = [];
  for (const p of people) {
    const user = await User.create({
      email: `${p.u}@seed.nexora.local`, emailNormalized: `${p.u}@seed.nexora.local`, passwordHash: hash, username: p.u, usernameNormalized: p.u,
      displayName: p.n, interests: p.interests, languages: p.langs, emailVerifiedAt: new Date(), onboarding: { step: 5, completed: true }, isSeed: true,
    });
    await UserSkill.insertMany([...p.teach.map((n) => ({ user: user._id, name: n, skillKey: n.toLowerCase().replace(/\s+/g, '-'), kind: 'teach', level: 'intermediate' })), ...p.learn.map((n) => ({ user: user._id, name: n, skillKey: n.toLowerCase().replace(/\s+/g, '-'), kind: 'learn', level: 'beginner' }))]);
    users.push(user);
  }
  const [sara, omar, lina, , nora] = users as [typeof users[0], typeof users[0], typeof users[0], typeof users[0], typeof users[0]];

  const mkCommunity = async (name: string, slug: string, category: string, owner: typeof sara, members: Array<typeof sara>, description: string) => {
    const c = await Community.create({ name, slug, category, description, owner: owner._id, memberCount: members.length + 1, isSeed: true, tags: [category] });
    await CommunityMembership.insertMany([{ community: c._id, user: owner._id, role: 'owner' }, ...members.map((m) => ({ community: c._id, user: m._id }))]);
    return c;
  };
  const react = await mkCommunity('React Developers', 'react-developers', 'programming', sara, [omar, lina, nora], 'Hooks, patterns and code reviews.');
  const english = await mkCommunity('English Practice', 'english-practice', 'languages', omar, [sara, lina], 'Daily conversation practice for learners.');

  await Post.insertMany([
    { author: sara._id, community: react._id, type: 'discussion', body: 'What is your favorite way to structure a React Native project?', tags: ['react', 'architecture'], isSeed: true },
    { author: nora._id, community: react._id, type: 'question', title: 'How do I avoid re-renders in lists?', body: 'My FlatList re-renders every row. Any tips?', tags: ['performance'], isSeed: true },
    { author: omar._id, community: english._id, type: 'resource', title: 'Five phrases for meetings', body: 'Useful phrases for professional meetings: “Let me circle back”, “Could you clarify?”…', tags: ['english'], isSeed: true },
  ]);
  await Community.updateOne({ _id: react._id }, { postCount: 2 });
  await Community.updateOne({ _id: english._id }, { postCount: 1 });

  await SkillOffer.insertMany([
    { owner: sara._id, title: 'I can help you understand React hooks', description: 'Live walkthrough with exercises.', skill: 'React', skillKey: 'react', format: 'video' },
    { owner: omar._id, title: 'Practice conversational English with me', description: '30-minute casual conversation sessions.', skill: 'English', skillKey: 'english', format: 'audio' },
  ]);

  const project = await Project.create({ owner: sara._id, title: 'Open-source habit tracker', description: 'A small mobile app built by a team.', category: 'programming', skills: ['react', 'design'], goals: ['Ship v1'], deliverables: ['Mobile app', 'Landing page'], status: 'active', isSeed: true });
  await ProjectMembership.insertMany([{ project: project._id, user: sara._id, role: 'owner' }, { project: project._id, user: lina._id }]);
  await ProjectTask.insertMany([
    { project: project._id, creator: sara._id, assignee: lina._id, title: 'Design onboarding screens', status: 'in_progress', priority: 'high' },
    { project: project._id, creator: sara._id, assignee: sara._id, title: 'Set up the API', status: 'done', completedAt: new Date() },
    { project: project._id, creator: sara._id, title: 'Write the README', status: 'todo' },
  ]);

  await Event.insertMany([
    { host: omar._id, community: english._id, title: 'Weekly English conversation', description: 'Open practice room.', type: 'language_practice', startsAt: new Date(Date.now() + 3 * 86_400_000), timeZone: 'Africa/Casablanca', isSeed: true },
    { host: sara._id, title: 'React hooks workshop', type: 'workshop', startsAt: new Date(Date.now() + 6 * 86_400_000), timeZone: 'UTC', capacity: 20, isSeed: true },
  ]);

  const goal = await Goal.create({ user: sara._id, title: 'Publish my portfolio', category: 'career', isSeed: true });
  await GoalMilestone.insertMany([{ goal: goal._id, user: sara._id, title: 'Pick 3 projects', completedAt: new Date() }, { goal: goal._id, user: sara._id, title: 'Write case studies' }]);

  console.log('\nSeed complete (flagged isSeed). Sign in with any of these emails:');
  people.forEach((p) => console.log(`  ${p.u}@seed.nexora.local`));
  console.log(`Password for all (random, shown once): ${password}\n`);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
