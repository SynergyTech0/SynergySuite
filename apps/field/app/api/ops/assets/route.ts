import { route } from "@/lib/api";
import { searchOpsAssets } from "@/lib/ops";

/** Assets in Ops' register, to bring onto a customer: ?q= */
export const GET = route(async (me, req) => searchOpsAssets(me.email, new URL(req.url).searchParams.get("q") ?? ""));
