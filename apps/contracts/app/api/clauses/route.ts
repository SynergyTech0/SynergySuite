import { body, route } from "@/lib/api";
import { listClauses, saveClause } from "@/lib/library";

export const GET = route(async (_me, req) => listClauses(new URL(req.url).searchParams.get("all") === "1"));
export const POST = route(async (me, req) => saveClause(me, null, await body(req)));
