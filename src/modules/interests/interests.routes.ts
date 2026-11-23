import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { Interest } from '../../database/models/Interest';
import { asyncHandler, ok } from '../../utils/http';

const querySchema = z.object({
  q: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const router = Router();

// Curated interests first, then popular custom ones. Used by onboarding.
router.get('/', authenticate, validate({ query: querySchema }), asyncHandler(async (req, res) => {
  const { q, limit } = req.query as unknown as z.infer<typeof querySchema>;
  const filter = q ? { slug: { $regex: `^${q.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } } : {};
  const rows = await Interest.find(filter).sort({ isCustom: 1, slug: 1 }).limit(limit).lean();
  ok(
    res,
    rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      labels: Object.fromEntries(r.labels ?? []),
      isCustom: r.isCustom,
    })),
  );
}));

export default router;
