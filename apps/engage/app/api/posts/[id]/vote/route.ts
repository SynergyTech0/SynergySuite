import { type Params, body, route } from "@/lib/api";
import { vote } from "@/lib/engage";

export const POST = route(async (me, req, { params }: Params<"id">) => vote(me, (await params).id, (await body(req)).optionId));
