import { type Params, body, route } from "@/lib/api";
import { bill, preview } from "@/lib/billing";

export const GET = route(async (me, _req, { params }: Params<"id">) => preview(me.email, (await params).id));

/** Bills the completed job: to Books as a draft invoice when linked. */
export const POST = route(async (me, req, { params }: Params<"id">) => bill(me.email, (await params).id, await body(req).catch(() => ({}))));
