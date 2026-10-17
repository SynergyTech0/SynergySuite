import { type Params, route } from "@/lib/api";
import { suggest } from "@/lib/schedule";

/** Who could take the job soonest, from ?day= (YYYY-MM-DD) for a week. */
export const GET = route(async (me, req, { params }: Params<"id">) =>
  suggest(me.email, (await params).id, new URL(req.url).searchParams.get("day") ?? undefined),
);
