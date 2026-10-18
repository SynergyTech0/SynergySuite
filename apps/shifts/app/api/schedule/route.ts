import { route } from "@/lib/api";
import { schedule } from "@/lib/shifts";

export const GET = route(async (me, req) => schedule(me, new URL(req.url).searchParams.get("week") || undefined));
