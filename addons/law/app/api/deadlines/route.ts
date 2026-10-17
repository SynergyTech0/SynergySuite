import { route } from "@/lib/api";
import { listDeadlines } from "@/lib/law";

/** Open deadlines across the matters this person can see; `mine=1` for theirs only. */
export const GET = route(async (me, req) => listDeadlines(me, { upcoming: true, mine: new URL(req.url).searchParams.get("mine") === "1" }));
