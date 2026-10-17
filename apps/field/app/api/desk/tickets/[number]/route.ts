import { type Params, route } from "@/lib/api";
import { fetchTicket } from "@/lib/desk";

/** A Desk case, to check before turning it into a work order. */
export const GET = route(async (me, _req, { params }: Params<"number">) => fetchTicket(me.email, (await params).number));
