import { type Params, body, route } from "@/lib/api";
import { saveLabor } from "@/lib/workorders";

/** Time on the job a dispatcher adds by hand: { technician, day, hours, rate?, notes? } */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  await saveLabor(me.email, (await params).id, null, await body(req));
});
