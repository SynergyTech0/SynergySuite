import { type Params, route } from "@/lib/api";
import { projectExpenses } from "@/lib/time";

export const GET = route(async (me, _req, { params }: Params<"id">) => projectExpenses(me.email, (await params).id));
