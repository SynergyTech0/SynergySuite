import { body, vroute } from "@/lib/api";
import { listTemplates, saveTemplate } from "@/lib/hr";

export const GET = vroute(async () => listTemplates());
export const POST = vroute(async (v, req) => saveTemplate(v, null, await body(req)));
