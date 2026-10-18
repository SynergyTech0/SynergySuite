import { type Params, body, route } from "@/lib/api";
import { addNote } from "@/lib/hire";

export const POST = route(async (me, req, { params }: Params<"id">) => addNote(me, (await params).id, await body(req)));
