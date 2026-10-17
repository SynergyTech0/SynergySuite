import { body, route, type Params } from "@/lib/api";
import { deleteTemplate, getTemplate, updateTemplate } from "@/lib/templates";

export const dynamic = "force-dynamic";

export const GET = route(async (_ctx, _req, { params }: Params<"id">) => getTemplate((await params).id));
export const PATCH = route(async (ctx, req, { params }: Params<"id">) => updateTemplate(ctx, (await params).id, await body(req)));
export const DELETE = route(async (ctx, _req, { params }: Params<"id">) => deleteTemplate(ctx, (await params).id));
