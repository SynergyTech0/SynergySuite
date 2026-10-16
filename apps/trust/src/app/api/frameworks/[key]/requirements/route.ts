import { route, NotFoundError } from '@/lib/api';
import { requirementStatuses } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * GET /api/frameworks/:key/requirements
 *
 * Every in-scope requirement with its derived status. 404 when the framework is unknown or
 * the tenant has not adopted it — returning an empty list would read as "nothing to do".
 */
export const GET = route(async (session, _req, ctx) => {
  const { key } = await ctx.params;
  const requirements = await requirementStatuses(session, key);
  if (requirements.length === 0) {
    throw new NotFoundError(
      `framework '${key}' is not adopted by this tenant, or has no in-scope requirements`,
    );
  }
  return { framework: key, count: requirements.length, requirements };
});
