import { body, route } from "@/lib/api";
import { draftDescription } from "@/lib/ai";

export const POST = route(async (me, req) => draftDescription(me, await body(req)));
