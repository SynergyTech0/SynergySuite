import { body, route } from "@/lib/http";
import { listMembers, shareDatabase, unshareDatabase } from "@/lib/sharing";

type P = { id: string };

export const GET = route<P>(async (_req, me, { id }) => ({ members: await listMembers(id, me.email) }));

/** POST `{ email, role }` gives someone access or changes their role (owners only). */
export const POST = route<P>(async (req, me, { id }) => ({ members: await shareDatabase(id, me.email, await body(req)) }));

/** DELETE `{ email }` takes someone's access away; anyone may remove themselves. */
export const DELETE = route<P>(async (req, me, { id }) => {
  const b = await body<{ email?: unknown }>(req);
  return { members: await unshareDatabase(id, me.email, b.email) };
});
