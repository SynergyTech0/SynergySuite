import { body, route } from "@/lib/http";
import { createReport, listReports } from "@/lib/reports";

type P = { id: string };

export const GET = route<P>(async (_req, me, { id }) => ({ reports: await listReports(id, me.email) }));

/** POST `{ name, source: { kind: "table" | "query", id }, layout? }` saves a report. */
export const POST = route<P>(async (req, me, { id }) => Response.json({ report: await createReport(id, me.email, await body(req)) }, { status: 201 }));
