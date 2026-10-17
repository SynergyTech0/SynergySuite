import { body, route } from "@/lib/api";
import { createSegment } from "@/lib/segments";

export const POST = route(async (ctx, req) => {
  const b = await body(req);
  return createSegment(ctx, String(b.audienceId ?? ""), b);
});
