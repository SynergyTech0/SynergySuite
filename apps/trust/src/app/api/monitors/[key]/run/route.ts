import { route, NotFoundError } from '@/lib/api';
import { sharedSql } from '@/lib/queries';
import { runMonitors } from '@/lib/collect-runner.mjs';

export const dynamic = 'force-dynamic';

/**
 * POST /api/monitors/:key/run
 *
 * Runs one monitor now and records the outcome. Note the status codes: a monitor that runs
 * and FAILS returns 200, because the request succeeded and the finding is the payload. Only
 * a monitor that could not be measured at all is an error condition — reporting a genuine
 * control failure as an HTTP 500 would train operators to ignore it.
 */
export const POST = route(async (session, _req, ctx) => {
  const { key } = await ctx.params;
  const outcome = await runMonitors(sharedSql(), session.tenantId, { monitorKey: key });

  if (outcome.results.length === 0) {
    throw new NotFoundError(`no enabled monitor with key '${key}'`);
  }
  return {
    monitor: key,
    ...outcome,
  };
}, { write: true });
