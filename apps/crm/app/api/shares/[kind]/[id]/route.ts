import { body, route, type Params } from "@/lib/api";
import * as access from "@/lib/access";

/** Who else can see the record (lib/access.ts). */
export const GET = route(async (ctx, _req, { params }: Params<"kind" | "id">) => {
  const p = await params;
  return access.shares(ctx, p.kind, p.id);
});

/** Replaces the list: { principals: ["rita@example.com", "*"] }. The owner or a manager only. */
export const PUT = route(async (ctx, req, { params }: Params<"kind" | "id">) => {
  const p = await params;
  return access.setShares(ctx, p.kind, p.id, (await body(req)).principals);
});
