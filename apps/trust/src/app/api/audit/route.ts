import { route } from '@/lib/api';
import { auditTrail } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * GET /api/audit?limit=n
 *
 * `intact` is computed by recomputing the hash chain on this request, not read from a
 * stored flag — a cached integrity claim is exactly the sort of assertion this product
 * exists to replace with a check.
 */
export const GET = route(async (session, req) => {
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? 100) || 100, 500);
  const { events, intact, break: broken } = await auditTrail(session, limit);
  return { intact, break: broken, count: events.length, events };
});
