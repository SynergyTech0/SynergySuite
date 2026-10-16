import { route } from '@/lib/api';
import { evidenceLedger } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** GET /api/evidence?limit=n — the append-only evidence ledger, newest first. */
export const GET = route(async (session, req) => {
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? 100) || 100, 500);
  const items = await evidenceLedger(session, limit);
  return { count: items.length, evidence: items };
});
