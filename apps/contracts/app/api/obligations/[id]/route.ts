import { body, route, type Params } from "@/lib/api";
import { deleteObligation, updateObligation } from "@/lib/contracts";

export const PATCH = route(async (me, req, { params }: Params<"id">) => updateObligation(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => deleteObligation(me, (await params).id));
