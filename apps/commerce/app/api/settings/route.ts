import { body, route } from "@/lib/api";
import { getSettings, saveSettings } from "@/lib/settings";

export const GET = route(async () => getSettings());
export const PUT = route(async (ctx, req) => saveSettings(ctx, await body(req)));
