import { route } from "@/lib/api";
import { voicemailsFor } from "@/lib/history";

export const dynamic = "force-dynamic";

export const GET = route(async (me) => voicemailsFor(me.email));
