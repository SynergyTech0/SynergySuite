import { body, route } from "@/lib/http";
import { createQuery, listQueries } from "@/lib/queries";

type P = { id: string };

export const GET = route<P>(async (_req, me, { id }) => ({ queries: await listQueries(id, me.email) }));

/** POST `{ name, kind: "design" | "sql", definition?, sql? }` saves a query. */
export const POST = route<P>(async (req, me, { id }) => {
  const query = await createQuery(id, me.email, await body(req));
  return Response.json({ query }, { status: 201 });
});
