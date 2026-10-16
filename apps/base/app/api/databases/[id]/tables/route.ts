import { body, route } from "@/lib/http";
import { createTable } from "@/lib/catalog";

/** POST `{ name, fields?: [{ name, type, options?, required? }] }` makes a table. */
export const POST = route<{ id: string }>(async (req, me, { id }) => {
  const b = await body<{ name?: unknown; fields?: unknown }>(req);
  const table = await createTable(id, me.email, { name: b.name, fields: Array.isArray(b.fields) ? b.fields : undefined });
  return Response.json({ table }, { status: 201 });
});
