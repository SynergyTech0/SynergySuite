import { body, route, type Params } from "@/lib/api";
import { deleteClause, saveClause } from "@/lib/library";

export const PUT = route(async (me, req, { params }: Params<"id">) => saveClause(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => deleteClause(me, (await params).id));
