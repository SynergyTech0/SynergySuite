import { body, idOf, route, type Params } from "@/lib/api";
import { adjust } from "@/lib/stock";

/** A receipt or a count correction. */
export const POST = route(async (me, req, { params }: Params<"id">) => adjust(idOf((await params).id), await body(req), me.email));
