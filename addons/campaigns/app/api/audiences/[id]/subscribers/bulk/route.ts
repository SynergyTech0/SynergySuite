import { body, route, type Params } from "@/lib/api";
import { deleteSubscribers, tagSubscribers } from "@/lib/audiences";
import { UserError } from "@/lib/util";

/** Several subscribers at once: { action: "delete" | "tag" | "untag", ids, tags }. */
export const POST = route(async (ctx, req, { params }: Params<"id">) => {
  const id = (await params).id;
  const b = await body<{ action?: string; ids?: unknown; tags?: unknown }>(req);
  if (b.action === "delete") return { count: await deleteSubscribers(ctx, id, b.ids) };
  if (b.action === "tag" || b.action === "untag") return { count: await tagSubscribers(ctx, id, b.ids, b.tags, b.action === "untag") };
  throw new UserError("Unknown action");
});
