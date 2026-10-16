import { body, route } from "@/lib/http";
import { deleteTable, getTable, updateTable } from "@/lib/catalog";

type P = { id: string };

export const GET = route<P>(async (_req, me, { id }) => {
  const { schema: _s, pgName: _p, ...table } = await getTable(id, me.email);
  return { table };
});

/** PATCH `{ name?, description?, position? }`. */
export const PATCH = route<P>(async (req, me, { id }) => ({ table: await updateTable(id, me.email, await body(req)) }));

export const DELETE = route<P>(async (_req, me, { id }) => {
  await deleteTable(id, me.email);
});
