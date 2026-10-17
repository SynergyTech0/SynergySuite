import { type Params, body, route } from "@/lib/api";
import { removeCheck, setCheck } from "@/lib/workorders";

export const PATCH = route(async (me, req, { params }: Params<"id" | "checkId">) => {
  const { id, checkId } = await params;
  await setCheck(me.email, id, checkId, (await body(req)).done === true);
});

export const DELETE = route(async (me, _req, { params }: Params<"id" | "checkId">) => {
  const { id, checkId } = await params;
  await removeCheck(me.email, id, checkId);
});
