import { body, route } from "@/lib/api";
import { listChecks, runCheck } from "@/lib/conflicts";

export const GET = route(async (me) => listChecks(me));
export const POST = route(async (me, req) => runCheck(me, await body(req)));
