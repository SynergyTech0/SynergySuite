import { type Params, clientIp, publicRoute } from "@/lib/api";
import { slotsForMove } from "@/lib/appointments";
import { limit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export const GET = publicRoute(async (req, { params }: Params<"token">) => {
  limit(`slots:${clientIp(req)}`, 120, 60_000);
  const u = new URL(req.url).searchParams;
  return (await slotsForMove((await params).token, u.get("from") ?? "", u.get("to") ?? "")).map((s) => ({ start: s.start, staffIds: [] }));
});
