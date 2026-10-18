import { body, requireAdmin, route } from "@/lib/api";
import { getSettings, saveSettings } from "@/lib/settings";

export const GET = route(async () => ({ settings: await getSettings() }));

export const PUT = route(async (me, req) => {
  requireAdmin(me);
  return { settings: await saveSettings(await body(req)) };
});
