import { body, route } from "@/lib/http";
import { importCsv } from "@/lib/import";

/** POST `{ name, csv }` makes a table from a CSV file's text. */
export const POST = route<{ id: string }>(async (req, me, { id }) => {
  const result = await importCsv(id, me.email, await body(req));
  return Response.json(result, { status: 201 });
});
