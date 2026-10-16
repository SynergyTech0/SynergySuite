import { body, route, type Params } from "@/lib/api";
import { get, remove, update } from "@/lib/contacts";
import type { ContactInput } from "@/lib/types";

export const GET = route(async (me, _req, { params }: Params<"id">) => get(me.email, (await params).id));

export const PATCH = route(async (me, req, { params }: Params<"id">) => update(me.email, (await params).id, await body<Partial<ContactInput>>(req)));

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await remove(me.email, [(await params).id]);
});
