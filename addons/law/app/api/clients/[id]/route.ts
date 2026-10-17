import { type Params, body, route } from "@/lib/api";
import { deleteClient, getClient, updateClient } from "@/lib/law";

export const GET = route(async (me, _req, { params }: Params<"id">) => getClient(me, (await params).id));
export const PATCH = route(async (me, req, { params }: Params<"id">) => updateClient(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteClient(me, (await params).id);
  return { ok: true };
});
