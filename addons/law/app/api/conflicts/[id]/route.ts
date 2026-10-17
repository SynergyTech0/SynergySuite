import { type Params, body, route } from "@/lib/api";
import { decideCheck, getCheck } from "@/lib/conflicts";

export const GET = route(async (me, _req, { params }: Params<"id">) => getCheck(me, (await params).id));
export const PATCH = route(async (me, req, { params }: Params<"id">) => decideCheck(me, (await params).id, await body(req)));
