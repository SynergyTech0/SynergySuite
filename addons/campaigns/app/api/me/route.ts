import { route } from "@/lib/api";
import { aiEnabled } from "@/lib/ai";
import * as members from "@/lib/members";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Who you are here, the team, whether AI is on, and the sender settings. */
export const GET = route(async (me) => ({ me, members: await members.list(), ai: aiEnabled(), settings: await getSettings() }));
