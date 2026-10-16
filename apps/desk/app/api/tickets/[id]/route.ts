import { body, idOf, route, type Params } from "@/lib/api";
import { get, update, type TicketPatch } from "@/lib/tickets";

export const GET = route(async (_me, _req, { params }: Params<"id">) => get(idOf((await params).id)));

export const PATCH = route(async (_me, req, { params }: Params<"id">) => update(idOf((await params).id), await body<TicketPatch>(req)));
