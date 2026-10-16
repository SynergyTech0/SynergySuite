import { type Params, adminRoute, body } from "@/lib/api";
import { needE164 } from "@/lib/numbers";
import { assignNumber, removeNumber } from "@/lib/trunks";

export const dynamic = "force-dynamic";

/** { assignedTo: email | null, label? } */
export const PATCH = adminRoute(async (_me, req, ctx: Params<"number">) => {
  const n = needE164(decodeURIComponent((await ctx.params).number));
  const b = await body<{ assignedTo?: string | null; label?: string }>(req);
  return assignNumber(n, b.assignedTo, b.label);
});

export const DELETE = adminRoute(async (_me, _req, ctx: Params<"number">) => removeNumber(needE164(decodeURIComponent((await ctx.params).number))));
