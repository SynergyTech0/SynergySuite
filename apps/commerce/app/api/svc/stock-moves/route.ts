import { svcRoute } from "@/lib/api";
import { stockMove } from "@/lib/svc";
import { UserError } from "@/lib/util";

/** Parts used and products made by Operations; see lib/svc.ts for the shape. */
export const POST = svcRoute(async (req) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw new UserError("Bad request body");
  return stockMove(body);
});
