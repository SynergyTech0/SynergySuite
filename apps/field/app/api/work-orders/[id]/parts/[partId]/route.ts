import { type Params, route } from "@/lib/api";
import { removePart } from "@/lib/parts";

export const DELETE = route(async (me, _req, { params }: Params<"id" | "partId">) => {
  const { id, partId } = await params;
  await removePart(me.email, id, partId);
});
