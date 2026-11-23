import type { PageMeta } from '../shared/index';

/** Cursor pagination over _id (descending). Fetch limit+1 rows, then call this. */
export function buildPage<T extends { _id: unknown }>(rows: T[], limit: number): { items: T[]; meta: PageMeta } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, meta: { nextCursor: hasMore && last ? String(last._id) : null, limit } };
}
