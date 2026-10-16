import { type Params, body, route } from "@/lib/api";
import { copy } from "@/lib/diagrams";

export const POST = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const b = await body<{ name?: string }>(req).catch(() => ({}) as { name?: string });
  return copy(me.email, id, b.name);
});
