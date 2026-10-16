import { route } from "@/lib/api";
import { dashboard } from "@/lib/contracts";

export const GET = route(async (me) => dashboard(me));
