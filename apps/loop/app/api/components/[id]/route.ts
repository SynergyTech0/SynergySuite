import { type Params, body, route } from "@/lib/api";
import { deleteComponent, getComponent, updateComponent } from "@/lib/loop";

export const GET = route(async (me, req, { params }: Params<"id">) =>
  getComponent(me, (await params).id, new URL(req.url).searchParams.get("quiet") === "1"),
);
export const PATCH = route(async (me, req, { params }: Params<"id">) => updateComponent(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => deleteComponent(me, (await params).id));
