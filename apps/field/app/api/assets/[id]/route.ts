import { type Params, body, route } from "@/lib/api";
import { deleteAsset, getAsset, saveAsset } from "@/lib/customers";

export const GET = route(async (me, _req, { params }: Params<"id">) => getAsset(me.email, (await params).id));
export const PUT = route(async (me, req, { params }: Params<"id">) => saveAsset(me.email, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteAsset(me.email, (await params).id);
});
