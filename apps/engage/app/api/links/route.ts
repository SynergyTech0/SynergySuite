import { body, route } from "@/lib/api";
import { addQuickLink, quickLinks } from "@/lib/engage";

export const GET = route(async () => quickLinks());
export const POST = route(async (me, req) => addQuickLink(me, await body(req)));
