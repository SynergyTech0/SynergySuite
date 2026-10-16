import { body, route } from "@/lib/api";
import { createAutomation, listAutomations } from "@/lib/automations";

export const dynamic = "force-dynamic";

export const GET = route(async () => listAutomations());
export const POST = route(async (ctx, req) => createAutomation(ctx, await body(req)));
