import { type Params, body, route } from "@/lib/api";
import { addNote } from "@/lib/workorders";

export const POST = route(async (me, req, { params }: Params<"id">) => {
  await addNote(me.email, (await params).id, (await body(req)).body);
});
