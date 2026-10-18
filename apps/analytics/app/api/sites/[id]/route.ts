import { body, route, type Params } from "@/lib/api";
import { deleteSite, updateSite } from "@/lib/sites";

export const PATCH = route(async (me, req, { params }: Params<"id">) => ({ site: await updateSite(me, (await params).id, await body(req)) }));

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteSite(me, (await params).id);
  return { ok: true };
});
