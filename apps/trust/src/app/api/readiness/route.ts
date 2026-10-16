import { route } from '@/lib/api';
import { frameworkSummaries, EVIDENCE_WINDOW_DAYS } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * GET /api/readiness
 *
 * Readiness per adopted framework. Two figures are returned deliberately:
 * `implemented_pct` (what owners assert) and `audit_ready_pct` (implemented AND evidenced
 * inside the window). Anything consuming one number should consume the second.
 */
export const GET = route(async (session) => ({
  tenant: { slug: session.tenantSlug, name: session.tenantName },
  evidence_window_days: EVIDENCE_WINDOW_DAYS,
  frameworks: await frameworkSummaries(session),
}));
