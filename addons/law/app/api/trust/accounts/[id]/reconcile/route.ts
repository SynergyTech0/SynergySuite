import { type Params, body, route } from "@/lib/api";
import { reconcile, reconciliations } from "@/lib/trust";

export const GET = route(async (me, _req, { params }: Params<"id">) => reconciliations(me, (await params).id));
export const POST = route(async (me, req, { params }: Params<"id">) => reconcile(me, (await params).id, await body(req)));
