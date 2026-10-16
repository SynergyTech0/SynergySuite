import { body, route } from "@/lib/api";
import { createTemplate, listTemplates } from "@/lib/templates";

export const dynamic = "force-dynamic";

export const GET = route(async () => listTemplates());
export const POST = route(async (ctx, req) => createTemplate(ctx, await body(req)));
