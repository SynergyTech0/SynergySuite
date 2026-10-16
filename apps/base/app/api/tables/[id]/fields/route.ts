import { body, route } from "@/lib/http";
import { addField } from "@/lib/catalog";

/** POST `{ name, type, options?, required?, description? }` adds a field. */
export const POST = route<{ id: string }>(async (req, me, { id }) => {
  const field = await addField(id, me.email, await body(req));
  return Response.json({ field }, { status: 201 });
});
