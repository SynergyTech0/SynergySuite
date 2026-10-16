import { route } from "@/lib/api";
import { movements } from "@/lib/stock";

export const GET = route(async (_ctx, req) => {
  const u = new URL(req.url).searchParams;
  return movements({ productId: u.get("product") ?? undefined, locationId: u.get("location") ?? undefined });
});
