import { route, type Params } from "@/lib/api";
import { claim } from "@/lib/shifts";

export const POST = route(async (me, _req, { params }: Params<"id">) => claim(me, (await params).id));
