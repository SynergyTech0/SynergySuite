import { body, route, type Params } from "@/lib/api";
import { addObligation } from "@/lib/contracts";

export const POST = route(async (me, req, { params }: Params<"id">) => addObligation(me, (await params).id, await body(req)));
