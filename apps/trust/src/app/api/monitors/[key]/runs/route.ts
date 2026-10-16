import { route } from '@/lib/api';
import { monitorRuns } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** GET /api/monitors/:key/runs — the append-only run series for one monitor. */
export const GET = route(async (session, req, ctx) => {
  const { key } = await ctx.params;
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? 60) || 60, 500);
  const runs = await monitorRuns(session, key, limit);
  return { monitor: key, count: runs.length, runs };
});
