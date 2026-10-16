import { body, route, type Params } from "@/lib/api";
import { deleteTemplate, saveTemplate } from "@/lib/library";

export const PUT = route(async (me, req, { params }: Params<"id">) => saveTemplate(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => deleteTemplate(me, (await params).id));
