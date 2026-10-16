import { body, route } from "@/lib/api";
import { listTemplates, saveTemplate } from "@/lib/library";

export const GET = route(async (_me, req) => listTemplates(new URL(req.url).searchParams.get("all") === "1"));
export const POST = route(async (me, req) => saveTemplate(me, null, await body(req)));
