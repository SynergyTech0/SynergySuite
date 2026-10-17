import { type Params, body, route } from "@/lib/api";
import { addDeadline, listDeadlines } from "@/lib/law";

export const GET = route(async (me, _req, { params }: Params<"id">) => {
  const { id } = await params;
  return listDeadlines(me, { matterId: id });
});
export const POST = route(async (me, req, { params }: Params<"id">) => addDeadline(me, (await params).id, await body(req)));
