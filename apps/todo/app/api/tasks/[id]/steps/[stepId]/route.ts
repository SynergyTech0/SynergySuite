import { body, route, type Params } from "@/lib/api";
import { deleteStep, updateStep } from "@/lib/todo";

export const PATCH = route(async (me, req, { params }: Params<"id" | "stepId">) => {
  const { id, stepId } = await params;
  await updateStep(me.email, id, stepId, await body(req));
});

export const DELETE = route(async (me, _req, { params }: Params<"id" | "stepId">) => {
  const { id, stepId } = await params;
  await deleteStep(me.email, id, stepId);
});
