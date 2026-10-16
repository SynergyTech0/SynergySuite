import { body, route, type Params } from "@/lib/api";
import { addStep } from "@/lib/todo";

export const POST = route(async (me, req, { params }: Params<"id">) => {
  await addStep(me.email, (await params).id, (await body<{ title?: string }>(req)).title);
});
