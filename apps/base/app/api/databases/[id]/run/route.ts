import { body, route } from "@/lib/http";
import { runQuery } from "@/lib/queries";

/**
 * POST `{ queryId }` runs a saved query; `{ kind: "sql", sql }` or `{ kind: "design", definition }`
 * runs one being edited. Answers `{ columns, rows, truncated, ms, sql }` (up to 1,000 rows).
 */
export const POST = route<{ id: string }>(async (req, me, { id }) => {
  const b = await body<{ queryId?: unknown; kind?: unknown; sql?: unknown; definition?: unknown }>(req);
  return runQuery(id, me.email, {
    queryId: typeof b.queryId === "string" ? b.queryId : undefined,
    kind: b.kind === "sql" ? "sql" : "design",
    sql: b.sql,
    definition: b.definition,
  });
});
