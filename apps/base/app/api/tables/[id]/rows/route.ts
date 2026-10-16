import { body, HttpError, route } from "@/lib/http";
import { getTable } from "@/lib/catalog";
import { parseSpec, type Condition, type FilterSpec, type SortSpec } from "@/lib/filter";
import { deleteRows, insertRows, listRows } from "@/lib/rows";

type P = { id: string };

/** GET ?offset&limit&q&filter=<json>&sort=<json>&require=<json> reads a page of records. */
export const GET = route<P>(async (req, me, { id }) => {
  const t = await getTable(id, me.email);
  const sp = new URL(req.url).searchParams;
  return listRows(t, {
    offset: Number(sp.get("offset")) || 0,
    limit: Number(sp.get("limit")) || 100,
    search: sp.get("q"),
    filter: parseSpec<FilterSpec>(sp.get("filter")),
    sort: parseSpec<SortSpec>(sp.get("sort")),
    require: parseSpec<Condition[]>(sp.get("require")),
  });
});

/** POST `{ records: [{ <fieldId>: value }] }` adds records. */
export const POST = route<P>(async (req, me, { id }) => {
  const t = await getTable(id, me.email);
  const b = await body<{ records?: unknown }>(req);
  if (!Array.isArray(b.records)) throw new HttpError(400, "Expected records");
  return Response.json({ rows: await insertRows(t, me.email, b.records) }, { status: 201 });
});

/** DELETE `{ ids: [...] }` deletes records. */
export const DELETE = route<P>(async (req, me, { id }) => {
  const t = await getTable(id, me.email);
  const b = await body<{ ids?: unknown }>(req);
  return { deleted: await deleteRows(t, b.ids as unknown[]) };
});
