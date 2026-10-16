import { type Params, body, route } from "@/lib/api";
import { type ServiceInput, deleteService, updateService } from "@/lib/pages";

export const PATCH = route(async (me, req, { params }: Params<"id">) => updateService(me, (await params).id, await body<ServiceInput>(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteService(me, (await params).id);
  return { ok: true };
});
