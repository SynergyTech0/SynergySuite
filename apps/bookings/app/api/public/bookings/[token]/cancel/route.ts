import { type Params, body, clientIp, publicRoute } from "@/lib/api";
import { cancelByCustomer, forCustomer } from "@/lib/appointments";
import { limit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export const POST = publicRoute(async (req, { params }: Params<"token">) => {
  limit(`change:${clientIp(req)}`, 20, 3_600_000);
  const token = (await params).token;
  await cancelByCustomer(token, (await body<{ reason?: string }>(req)).reason);
  return forCustomer(token);
});
