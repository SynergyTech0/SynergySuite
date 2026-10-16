import { route } from "@/lib/api";
import { assetCounts } from "@/lib/assets";
import { stockLink } from "@/lib/commerce";

export const GET = route(async (me) => ({ me, stock: await stockLink(), counts: await assetCounts(me.email) }));
