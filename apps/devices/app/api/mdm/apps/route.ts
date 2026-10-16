import { adminRoute, body, route } from "@/lib/api";
import { createApp, listApps } from "@/lib/mdm/catalog";

/** Everyone: owners can install these on their own devices. */
export const GET = route(async () => listApps());

/** { name, platform, source: "app_store", store } or { name, source: "package", url, bundle_id, version }. */
export const POST = adminRoute(async (me, req) => createApp(me, await body(req)));
