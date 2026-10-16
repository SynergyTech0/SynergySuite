import { type Params, body, route } from "@/lib/api";
import { deleteCommunity, getCommunity, updateCommunity } from "@/lib/engage";

export const GET = route(async (me, _req, { params }: Params<"id">) => getCommunity(me.email, (await params).id));
export const PATCH = route(async (me, req, { params }: Params<"id">) => updateCommunity(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteCommunity(me, (await params).id);
});
