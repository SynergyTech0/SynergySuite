import { type Params, body, route } from "@/lib/api";
import { addComponentMember, removeComponentMember } from "@/lib/loop";

export const POST = route(async (me, req, { params }: Params<"id">) => addComponentMember(me, (await params).id, await body(req)));
export const DELETE = route(async (me, req, { params }: Params<"id">) =>
  removeComponentMember(me, (await params).id, new URL(req.url).searchParams.get("email")),
);
