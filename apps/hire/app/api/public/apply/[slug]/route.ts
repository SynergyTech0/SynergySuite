import { type Params, body, clientIp, publicRoute } from "@/lib/api";
import { apply } from "@/lib/hire";
import { limit } from "@/lib/ratelimit";

/** An application from the careers page. No sign-in; limited per address. */
export const POST = publicRoute(async (req, { params }: Params<"slug">) => {
  limit(`apply:${clientIp(req)}`, 10, 3_600_000);
  return apply((await params).slug, await body(req));
});
