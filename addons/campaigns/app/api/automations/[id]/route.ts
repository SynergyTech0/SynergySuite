import { body, route, type Params } from "@/lib/api";
import { deleteAutomation, getAutomation, updateAutomation } from "@/lib/automations";

export const dynamic = "force-dynamic";

export const GET = route(async (_ctx, _req, { params }: Params<"id">) => getAutomation((await params).id));
export const PATCH = route(async (ctx, req, { params }: Params<"id">) => updateAutomation(ctx, (await params).id, await body(req)));
export const DELETE = route(async (ctx, _req, { params }: Params<"id">) => deleteAutomation(ctx, (await params).id));
