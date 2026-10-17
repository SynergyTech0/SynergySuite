import { route } from "@/lib/api";
import { dashboard } from "@/lib/dashboard";

export const GET = route(async (me) => dashboard(me));
