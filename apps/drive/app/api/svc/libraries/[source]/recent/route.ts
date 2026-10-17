import type { Params } from "@/lib/api";
import { svcRoute, teamRecent } from "@/lib/svc";

/** Groups: the team library's latest files, for the team's home page. */
export const GET = svcRoute(async (req, { params }: Params<"source">) => ({
  items: await teamRecent((await params).source, new URL(req.url).searchParams.get("limit")),
}));
