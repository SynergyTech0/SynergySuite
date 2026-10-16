import { body, route, type Params } from "@/lib/api";
import { addSubscriber, listSubscribers } from "@/lib/audiences";

export const dynamic = "force-dynamic";

export const GET = route(async (_ctx, req, { params }: Params<"id">) => {
  const u = new URL(req.url).searchParams;
  return listSubscribers((await params).id, {
    q: (u.get("q") ?? "").trim().slice(0, 200), status: u.get("status") ?? "", tag: u.get("tag") ?? "", offset: Number(u.get("offset")) || 0,
  });
});
export const POST = route(async (ctx, req, { params }: Params<"id">) => addSubscriber(ctx, (await params).id, await body(req)));
