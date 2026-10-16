import { route } from "@/lib/http";
import { csvHeaders, queryCsv } from "@/lib/exportCsv";
import { getQuery } from "@/lib/queries";

/** GET downloads a saved query's results as CSV (up to 200,000 rows). */
export const GET = route<{ id: string }>(async (_req, me, { id }) => {
  const q = await getQuery(id, me.email);
  return new Response(await queryCsv(q, me.email), { headers: csvHeaders(q.name) });
});
