import { route, type Params } from "@/lib/api";
import { report } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

export const GET = route(async (_ctx, req, { params }: Params<"id">) => {
  const u = new URL(req.url).searchParams;
  return report((await params).id, { filter: u.get("filter") ?? "", offset: Number(u.get("offset")) || 0 });
});
