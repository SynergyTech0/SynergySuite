import { body, idOf, route, type Params } from "@/lib/api";
import { addReading } from "@/lib/assets";

export const POST = route(async (me, req, { params }: Params<"id">) => addReading(idOf((await params).id), await body(req), me.email));
