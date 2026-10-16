import { type Params, body, vroute } from "@/lib/api";
import { deleteTemplate, saveTemplate } from "@/lib/hr";

export const PUT = vroute(async (v, req, { params }: Params<"id">) => saveTemplate(v, (await params).id, await body(req)));
export const DELETE = vroute(async (v, _req, { params }: Params<"id">) => deleteTemplate(v, (await params).id));
