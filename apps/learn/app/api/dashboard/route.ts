import { route } from "@/lib/api";
import { dashboard } from "@/lib/learn";

export const GET = route(async (me) => dashboard(me));
