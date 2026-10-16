import { body, route } from "@/lib/api";
import { createLabel, labelSettings, saveLabelSettings } from "@/lib/protection";

export const GET = route("protection", async () => labelSettings());
export const POST = route("protection", async (me, req) => createLabel(me, await body(req)));
/** The default label and the order of the list. */
export const PUT = route("protection", async (me, req) => saveLabelSettings(me, await body(req)));
