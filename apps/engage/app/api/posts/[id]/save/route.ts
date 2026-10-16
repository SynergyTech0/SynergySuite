import { type Params, body, route } from "@/lib/api";
import { save } from "@/lib/engage";

export const POST = route(async (me, req, { params }: Params<"id">) => {
  await save(me, (await params).id, (await body(req)).on !== false);
});
