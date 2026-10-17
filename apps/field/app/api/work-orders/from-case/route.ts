import { body, route } from "@/lib/api";
import { workOrderFromTicket } from "@/lib/desk";
import { getWorkOrder } from "@/lib/workorders";

/** A work order from a Desk case: { number, kind?, skill?, estimateHours?, again? } */
export const POST = route(async (me, req) => getWorkOrder(me.email, await workOrderFromTicket(me.email, await body(req))));
