import { body, route } from "@/lib/http";
import { listMembers, removeMember, setMember } from "@/lib/apps";

type P = { id: string };

export const GET = route<P>(async (_req, me, { id }) => ({ members: await listMembers(id, me.email) }));

/** PUT `{ email, role }` shares the app (email "*" is everyone in the organization). */
export const PUT = route<P>(async (req, me, { id }) => ({ members: await setMember(id, me.email, await body(req)) }));

/** DELETE ?email= stops sharing with someone (or leaves the app). */
export const DELETE = route<P>(async (req, me, { id }) => ({ members: await removeMember(id, me.email, new URL(req.url).searchParams.get("email") ?? "") }));
