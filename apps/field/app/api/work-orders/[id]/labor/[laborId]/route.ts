import { type Params, body, route } from "@/lib/api";
import { saveLabor } from "@/lib/workorders";

export const PATCH = route(async (me, req, { params }: Params<"id" | "laborId">) => {
  const { id, laborId } = await params;
  await saveLabor(me.email, id, laborId, await body(req));
});

export const DELETE = route(async (me, _req, { params }: Params<"id" | "laborId">) => {
  const { id, laborId } = await params;
  await saveLabor(me.email, id, laborId, { remove: true });
});
