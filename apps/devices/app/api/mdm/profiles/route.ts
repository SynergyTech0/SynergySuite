import { adminRoute, body } from "@/lib/api";
import { createProfile, listProfiles } from "@/lib/mdm/catalog";

export const GET = adminRoute(async () => listProfiles());

/** { name, description?, kind, settings, platforms? } — sent to matching enrolled devices at once. */
export const POST = adminRoute(async (me, req) => createProfile(me, await body(req)));
