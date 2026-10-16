import { type Params, body, clientIp, publicRoute } from "@/lib/api";
import { forCustomer, moveByCustomer } from "@/lib/appointments";
import { limit } from "@/lib/ratelimit";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

export const GET = publicRoute(async (_req, { params }: Params<"token">) => {
  const v = await forCustomer((await params).token);
  if (!v) throw new UserError("Booking not found", 404);
  return v;
});

/** The customer picks a new time: { start }. */
export const PATCH = publicRoute(async (req, { params }: Params<"token">) => {
  limit(`change:${clientIp(req)}`, 20, 3_600_000);
  const token = (await params).token;
  await moveByCustomer(token, (await body<{ start?: string }>(req)).start);
  return forCustomer(token);
});
