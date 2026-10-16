import { body, idOf, route, type Params } from "@/lib/api";
import { reply } from "@/lib/tickets";

// { body, internal } - internal: true saves a staff-only note instead of emailing the requester.
export const POST = route(async (me, req, { params }: Params<"id">) =>
  reply(idOf((await params).id), me.email, await body<{ body?: unknown; internal?: unknown }>(req)));
