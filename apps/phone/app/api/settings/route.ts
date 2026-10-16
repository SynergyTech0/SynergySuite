import { body, route } from "@/lib/api";
import { saveSettings, settingsOf } from "@/lib/people";

export const dynamic = "force-dynamic";

export const GET = route(async (me) => settingsOf(me.email));
export const PUT = route(async (me, req) => saveSettings(me.email, await body(req)));
