import { route, type Params } from "@/lib/api";
import { getAudience } from "@/lib/audiences";
import { assertCanEdit } from "@/lib/members";
import { syncAudience } from "@/lib/sources";

export const POST = route(async (ctx, _req, { params }: Params<"id">) => {
  assertCanEdit(ctx);
  const a = await getAudience((await params).id);
  return syncAudience(a.id);
});
