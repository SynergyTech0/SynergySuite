import { body, route } from "@/lib/api";
import { listPlans, savePlan } from "@/lib/assets";

export const GET = route(async () => listPlans());
export const POST = route(async (me, req) => savePlan(null, await body(req), me.email));
