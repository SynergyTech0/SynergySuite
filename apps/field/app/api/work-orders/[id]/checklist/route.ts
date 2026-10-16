import { type Params, body, route } from "@/lib/api";
import { addCheck } from "@/lib/workorders";

export const POST = route(async (me, req, { params }: Params<"id">) => {
  await addCheck(me.email, (await params).id, (await body(req)).title);
});
