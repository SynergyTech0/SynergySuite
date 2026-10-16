import { body, route, type Params } from "@/lib/api";
import { deleteGroup, renameGroup } from "@/lib/contacts";

export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  await renameGroup(me.email, (await params).id, String((await body<{ name?: string }>(req)).name ?? ""));
});

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteGroup(me.email, (await params).id);
});
