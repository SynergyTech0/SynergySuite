import { route } from '@/lib/api';
import { controls } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** GET /api/controls — the tenant's control library with mapping and evidence counts. */
export const GET = route(async (session) => {
  const items = await controls(session);
  return { count: items.length, controls: items };
});
