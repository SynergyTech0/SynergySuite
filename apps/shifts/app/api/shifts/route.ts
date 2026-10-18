import { body, route } from "@/lib/api";
import { createShift } from "@/lib/shifts";

export const POST = route(async (me, req) => createShift(me, await body(req)));
