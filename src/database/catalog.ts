

import { Interest } from './models/Interest';
import { ensureAchievementCatalog } from '../modules/achievements/achievements';

/**
 * Curated, production-safe catalog data (not demo data).
 * Idempotent.
 */
export const CURATED_INTERESTS: Array<{
  slug: string;
  en: string;
  ar: string;
}> = [
  { slug: 'programming', en: 'Programming', ar: 'البرمجة' },
  { slug: 'trading-finance', en: 'Trading and finance', ar: 'التداول والمال' },
  { slug: 'languages', en: 'Languages', ar: 'اللغات' },
  { slug: 'freelancing', en: 'Freelancing', ar: 'العمل الحر' },
  { slug: 'business', en: 'Business and entrepreneurship', ar: 'الأعمال وريادة الأعمال' },
  { slug: 'design', en: 'Design and creativity', ar: 'التصميم والإبداع' },
  { slug: 'career', en: 'Career development', ar: 'التطور المهني' },
  { slug: 'ai', en: 'Artificial intelligence', ar: 'الذكاء الاصطناعي' },
  { slug: 'health-lifestyle', en: 'Health and lifestyle', ar: 'الصحة ونمط الحياة' },
  { slug: 'personal-development', en: 'Personal development', ar: 'التطوير الشخصي' },
];

export async function ensureCatalog(): Promise<void> {
  await Interest.bulkWrite(
    CURATED_INTERESTS.map((i) => ({
      updateOne: {
        filter: { slug: i.slug },
        update: {
          $set: {
            name: i.en,
            labels: new Map<string, string>([
              ['en', i.en],
              ['ar', i.ar],
            ]),
            isCustom: false,
          },
        },
        upsert: true,
      },
    })),
  );

  await ensureAchievementCatalog();
}
/*

import { Interest } from './models/Interest';
import { ensureAchievementCatalog } from '../modules/achievements/achievements';

/** Curated, production-safe catalog data (not demo data). Idempotent. *//*
export const CURATED_INTERESTS: Array<{ slug: string; en: string; ar: string }> = [
  { slug: 'programming', en: 'Programming', ar: 'البرمجة' },
  { slug: 'trading-finance', en: 'Trading and finance', ar: 'التداول والمال' },
  { slug: 'languages', en: 'Languages', ar: 'اللغات' },
  { slug: 'freelancing', en: 'Freelancing', ar: 'العمل الحر' },
  { slug: 'business', en: 'Business and entrepreneurship', ar: 'الأعمال وريادة الأعمال' },
  { slug: 'design', en: 'Design and creativity', ar: 'التصميم والإبداع' },
  { slug: 'career', en: 'Career development', ar: 'التطور المهني' },
  { slug: 'ai', en: 'Artificial intelligence', ar: 'الذكاء الاصطناعي' },
  { slug: 'health-lifestyle', en: 'Health and lifestyle', ar: 'الصحة ونمط الحياة' },
  { slug: 'personal-development', en: 'Personal development', ar: 'التطوير الشخصي' },
];

export async function ensureCatalog(): Promise<void> {
  await Interest.bulkWrite(
    CURATED_INTERESTS.map((i) => ({
      updateOne: {
        filter: { slug: i.slug },
        update: { $set: { name: i.en, labels: { en: i.en, ar: i.ar }, isCustom: false } },
        upsert: true,
      },
    })),
  );
  await ensureAchievementCatalog();
}
*/