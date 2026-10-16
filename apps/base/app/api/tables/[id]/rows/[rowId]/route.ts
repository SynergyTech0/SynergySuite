import { body, route } from "@/lib/http";
import { getTable } from "@/lib/catalog";
import { updateRow } from "@/lib/rows";

/** PATCH `{ values: { <fieldId>: value } }` changes one record. */
export const PATCH = route<{ id: string; rowId: string }>(async (req, me, { id, rowId }) => {
  const t = await getTable(id, me.email);
  const b = await body<{ values?: Record<string, unknown> }>(req);
  return { row: await updateRow(t, me.email, rowId, b.values ?? {}) };
});
