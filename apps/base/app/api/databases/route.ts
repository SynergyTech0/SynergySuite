import { body, route } from "@/lib/http";
import { createDatabase, listDatabases } from "@/lib/catalog";

export const GET = route(async (_req, me) => ({ databases: await listDatabases(me.email) }));

/** POST `{ name, description? }` makes a new blank database. */
export const POST = route(async (req, me) => {
  const database = await createDatabase(me.email, await body(req));
  return Response.json({ database }, { status: 201 });
});
