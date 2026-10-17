import { type Params, body, route } from "@/lib/api";
import { addEntry, listEntries } from "@/lib/billing";

export const GET = route(async (me, req, { params }: Params<"id">) => listEntries(me, (await params).id, { mineOnly: new URL(req.url).searchParams.get("mine") === "1" }));
export const POST = route(async (me, req, { params }: Params<"id">) => addEntry(me, (await params).id, await body(req)));
