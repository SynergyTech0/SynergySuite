import { NextResponse } from "next/server";
import { aiFailure, askForSql, baseAiConfig } from "@/lib/ai";
import { getDatabase, listTables } from "@/lib/catalog";
import { body, HttpError, notFound, route } from "@/lib/http";
import { sqlScope } from "@/lib/queries";

type P = { id: string };

/** Whether an AI model is configured (the Ask box only shows when one is). */
export const GET = route<P>(async () => ({ enabled: (await baseAiConfig()) !== null }));

/** POST `{ question, sql? }` → `{ sql, explanation }`: a query written by the suite's AI model. */
export const POST = route<P>(async (req, me, { id }) => {
  if (!(await getDatabase(id, me.email))) throw notFound();
  const b = await body<{ question?: unknown; sql?: unknown; queryId?: unknown }>(req);
  const question = typeof b.question === "string" ? b.question.trim() : "";
  if (!question) throw new HttpError(400, "Ask a question about the data");
  const config = await baseAiConfig();
  if (!config) return NextResponse.json({ error: "AI is off: no model is configured for the suite" }, { status: 503 });
  const tables = await listTables(id, me.email);
  const scope = await sqlScope(id, tables, typeof b.queryId === "string" ? b.queryId : undefined);
  try {
    return await askForSql(question, tables, scope, typeof b.sql === "string" ? b.sql : undefined, config);
  } catch (e) {
    const err = aiFailure(e);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
});
