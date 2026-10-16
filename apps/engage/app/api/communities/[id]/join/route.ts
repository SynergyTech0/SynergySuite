import { type Params, route } from "@/lib/api";
import { join } from "@/lib/engage";

export const POST = route(async (me, _req, { params }: Params<"id">) => join(me, (await params).id));
