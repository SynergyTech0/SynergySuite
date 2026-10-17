import { type Params, body } from "@/lib/api";
import { dropTeamLibrary, putTeamLibrary, svcRoute } from "@/lib/svc";

/** Groups: make this team's library exactly { name, description?, members: [{ email, role }] }. */
export const PUT = svcRoute(async (req, { params }: Params<"source">) => putTeamLibrary((await params).source, await body(req)));

/** Groups: the team is gone. Members go, files stay. */
export const DELETE = svcRoute(async (_req, { params }: Params<"source">) => {
  await dropTeamLibrary((await params).source);
  return { ok: true };
});
