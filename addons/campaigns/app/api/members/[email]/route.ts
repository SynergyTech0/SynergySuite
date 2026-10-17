import { body, route, type Params } from "@/lib/api";
import { setRole } from "@/lib/members";

export const PATCH = route(async (ctx, req, { params }: Params<"email">) =>
  setRole(ctx, decodeURIComponent((await params).email), (await body<{ role?: string }>(req)).role));
