import { type Params, route } from "@/lib/api";
import { projectTime } from "@/lib/time";

export const GET = route(async (me, _req, { params }: Params<"id">) => projectTime(me.email, (await params).id));
