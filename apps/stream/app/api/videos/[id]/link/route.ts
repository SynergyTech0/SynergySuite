import { type Params, route } from "@/lib/api";
import { setLink } from "@/lib/videos";

/** POST makes a new "anyone with the link" link (the old one stops working); DELETE turns it off. */
export const POST = route(async (me, _req, { params }: Params<"id">) => ({ video: await setLink(me, (await params).id, true) }));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => ({ video: await setLink(me, (await params).id, false) }));
