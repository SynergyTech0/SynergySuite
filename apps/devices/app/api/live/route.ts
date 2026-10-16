import { adminRoute, body } from "@/lib/api";
import { createLive, listLive } from "@/lib/devices";

export const GET = adminRoute(async () => listLive());

/** { sql, devices: [id] } or { sql, all: true } */
export const POST = adminRoute(async (me, req) => createLive(me, await body(req)));
