import { type Params, body, route } from "@/lib/api";
import { follow } from "@/lib/engage";

export const POST = route(async (me, req, { params }: Params<"email">) => {
  await follow(me, decodeURIComponent((await params).email), (await body(req)).on !== false);
});
