import { route } from "@/lib/api";
import { mrpState, runPlanning } from "@/lib/mfg";

export const GET = route(async () => mrpState());
/** Runs planning now. */
export const POST = route(async (me) => runPlanning(me.email));
