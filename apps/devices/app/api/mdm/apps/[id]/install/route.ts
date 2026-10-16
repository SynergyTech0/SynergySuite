import { body, route, type Params } from "@/lib/api";
import { installApp } from "@/lib/mdm/catalog";

/** { devices: [id] } (admins, or owners on their own devices) or { all: true } (admins). */
export const POST = route(async (me, req, { params }: Params<"id">) => installApp(me, (await params).id, await body(req)));
