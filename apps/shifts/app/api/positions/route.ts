import { body, route } from "@/lib/api";
import { createPosition, listPositions } from "@/lib/shifts";

export const GET = route(async () => listPositions());
export const POST = route(async (me, req) => createPosition(me, await body(req)));
