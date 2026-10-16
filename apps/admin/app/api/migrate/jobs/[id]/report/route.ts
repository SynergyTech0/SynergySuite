import { route, type Params } from "@/lib/api";
import { getJob, reportCsv } from "@/lib/migrate";

/** One copy's report as a CSV file: counts, every skipped item with why, every error. */
export const GET = route("migrate", async (_me, _req, { params }: Params<"id">) => {
  const j = await getJob((await params).id);
  const name = `migration-${j.label.replace(/[^\w.-]+/g, "-").slice(0, 60) || j.id}.csv`;
  return new Response(reportCsv(j), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
});
