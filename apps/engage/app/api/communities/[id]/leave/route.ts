import { type Params, route } from "@/lib/api";
import { leave } from "@/lib/engage";

export const POST = route(async (me, _req, { params }: Params<"id">) => {
  await leave(me, (await params).id);
});
