import { type Params, adminRoute, body } from "@/lib/api";
import { addNumbers } from "@/lib/trunks";

export const dynamic = "force-dynamic";

/** { numbers: "+15551234567, +15551234568" } or a list. */
export const POST = adminRoute(async (_me, req, ctx: Params<"id">) => addNumbers((await ctx.params).id, (await body<{ numbers?: unknown }>(req)).numbers));
