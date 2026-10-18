import { route } from "@/lib/api";
import { isScheduler } from "@/lib/access";
import { rosterEntry } from "@/lib/shifts";

export const GET = route(async (me) => ({ email: me.email, name: me.name, admin: isScheduler(me.email), employee: await rosterEntry(me.email) }));
