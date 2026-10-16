import { body, notFound, route } from "@/lib/http";
import { deleteDatabase, getDatabase, listTables, updateDatabase } from "@/lib/catalog";
import { listForms } from "@/lib/forms";
import { listQueries } from "@/lib/queries";
import { listReports } from "@/lib/reports";

type P = { id: string };

/** The database, its tables with their fields, its saved queries, forms and reports. */
export const GET = route<P>(async (_req, me, { id }) => {
  const database = await getDatabase(id, me.email);
  if (!database) throw notFound();
  return { database, tables: await listTables(id, me.email), queries: await listQueries(id, me.email), forms: await listForms(id, me.email), reports: await listReports(id, me.email) };
});

export const PATCH = route<P>(async (req, me, { id }) => ({ database: await updateDatabase(id, me.email, await body(req)) }));

export const DELETE = route<P>(async (_req, me, { id }) => {
  await deleteDatabase(id, me.email);
});
