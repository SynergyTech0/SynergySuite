import { adminRoute, body, type Params } from "@/lib/api";
import { deleteApp, updateApp } from "@/lib/mdm/catalog";

/** { auto_install } */
export const PATCH = adminRoute(async (me, req, { params }: Params<"id">) => {
  await updateApp(me, (await params).id, await body(req));
  return { ok: true };
});

export const DELETE = adminRoute(async (me, _req, { params }: Params<"id">) => {
  await deleteApp(me, (await params).id);
  return { ok: true };
});
