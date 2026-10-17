import { body, route } from "@/lib/api";
import { saveSettings } from "@/lib/staff";

export const PUT = route(async (me, req) => saveSettings(me.email, await body(req)));
