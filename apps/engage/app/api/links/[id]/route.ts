import { type Params, body, route } from "@/lib/api";
import { deleteQuickLink, updateQuickLink } from "@/lib/engage";

export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  await updateQuickLink(me, (await params).id, await body(req));
});
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteQuickLink(me, (await params).id);
});
