import { body, route, type Params } from "@/lib/api";
import { deleteContact, updateContact } from "@/lib/sms";

export const PATCH = route(async (_me, req, { params }: Params<"id">) => updateContact((await params).id, await body(req)));
export const DELETE = route(async (_me, _req, { params }: Params<"id">) => {
  await deleteContact((await params).id);
  return { ok: true };
});
