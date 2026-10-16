import { body, route, type Params } from "@/lib/api";
import * as members from "@/lib/members";

export const PATCH = route(async (ctx, req, { params }: Params<"email">) =>
  members.setRole(ctx, decodeURIComponent((await params).email), (await body(req)).role));
