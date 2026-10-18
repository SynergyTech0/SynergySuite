import { type Params, body, route } from "@/lib/api";
import { addToHr } from "@/lib/hr";

/** Adds a hired candidate to HR, as the signed-in person (HR decides whether they may). */
export const POST = route(async (me, req, { params }: Params<"id">) => addToHr(me, (await params).id, await body(req)));
