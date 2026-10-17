import { type Params, body, route } from "@/lib/api";
import { addParty } from "@/lib/law";

export const POST = route(async (me, req, { params }: Params<"id">) => addParty(me, (await params).id, await body(req)));
