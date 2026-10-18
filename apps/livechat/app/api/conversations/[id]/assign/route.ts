import { body, route, type Params } from "@/lib/api";
import { assign } from "@/lib/chat";

export const POST = route(async (_me, req, { params }: Params<"id">) => {
  await assign((await params).id, (await body<{ to?: unknown }>(req)).to);
  return { ok: true };
});
