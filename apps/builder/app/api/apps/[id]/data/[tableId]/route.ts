import { body, HttpError, route } from "@/lib/http";
import { dataSourceFor } from "@/lib/apps";
import { deleteRows, insertRow, listRows, updateRow } from "@/lib/services";

/**
 * An app's records in one of its Base tables, read and written as the person using the app,
 * so Base decides what they may see and change. The table must be one of the app's data sources.
 */
type P = { id: string; tableId: string };

export const GET = route<P>(async (_req, me, { id, tableId }) => {
  await dataSourceFor(id, me.email, tableId);
  return listRows(me.email, tableId);
});

/** POST `{ values: { <fieldId>: value } }` adds a record. */
export const POST = route<P>(async (req, me, { id, tableId }) => {
  await dataSourceFor(id, me.email, tableId);
  const b = await body<{ values?: unknown }>(req);
  if (!b.values || typeof b.values !== "object") throw new HttpError(400, "Expected values");
  return Response.json({ row: await insertRow(me.email, tableId, b.values as Record<string, unknown>) }, { status: 201 });
});

/** PATCH `{ id, values }` changes a record. */
export const PATCH = route<P>(async (req, me, { id, tableId }) => {
  await dataSourceFor(id, me.email, tableId);
  const b = await body<{ id?: unknown; values?: unknown }>(req);
  if (typeof b.id !== "string" || !/^\d+$/.test(b.id)) throw new HttpError(400, "Expected a record id");
  if (!b.values || typeof b.values !== "object") throw new HttpError(400, "Expected values");
  return { row: await updateRow(me.email, tableId, b.id, b.values as Record<string, unknown>) };
});

/** DELETE `{ ids }` deletes records. */
export const DELETE = route<P>(async (req, me, { id, tableId }) => {
  await dataSourceFor(id, me.email, tableId);
  const b = await body<{ ids?: unknown }>(req);
  if (!Array.isArray(b.ids) || b.ids.some((x) => typeof x !== "string" || !/^\d+$/.test(x)) || b.ids.length > 1000) throw new HttpError(400, "Expected record ids");
  await deleteRows(me.email, tableId, b.ids as string[]);
});
