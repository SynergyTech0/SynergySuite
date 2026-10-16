import { body, route } from "@/lib/http";
import { deleteQuery, getQuery, updateQuery } from "@/lib/queries";

type P = { id: string };

export const GET = route<P>(async (_req, me, { id }) => {
  const { role: _role, ...query } = await getQuery(id, me.email);
  return { query };
});

export const PATCH = route<P>(async (req, me, { id }) => ({ query: await updateQuery(id, me.email, await body(req)) }));

export const DELETE = route<P>(async (_req, me, { id }) => {
  await deleteQuery(id, me.email);
});
