import { type Params, adminRoute, body } from "@/lib/api";
import { type TrunkInput, deleteTrunk, syncTrunk, updateTrunk } from "@/lib/trunks";

export const dynamic = "force-dynamic";

export const PATCH = adminRoute(async (_me, req, ctx: Params<"id">) => updateTrunk((await ctx.params).id, await body<TrunkInput & { clearPassword?: boolean; clearInboundPassword?: boolean }>(req)));
export const DELETE = adminRoute(async (_me, _req, ctx: Params<"id">) => deleteTrunk((await ctx.params).id));
/** Pushes the trunk to the media server again, e.g. after LiveKit was restarted without its data. */
export const POST = adminRoute(async (_me, _req, ctx: Params<"id">) => syncTrunk((await ctx.params).id));
