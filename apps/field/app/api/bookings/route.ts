import { body, route } from "@/lib/api";
import { book } from "@/lib/schedule";

/** Books a technician: { workOrderId, technician, start, end, force? } */
export const POST = route(async (me, req) => book(me.email, await body(req)));
