import { type Params, body, route } from "@/lib/api";
import { addPerson, removePerson } from "@/lib/law";

export const POST = route(async (me, req, { params }: Params<"id">) => {
  await addPerson(me, (await params).id, await body(req));
  return { ok: true };
});
export const DELETE = route(async (me, req, { params }: Params<"id">) => {
  await removePerson(me, (await params).id, new URL(req.url).searchParams.get("email") ?? "");
  return { ok: true };
});
