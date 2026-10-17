import { route } from "@/lib/api";
import { searchCatalog } from "@/lib/parts";

/** Parts in Commerce's catalog with price and stock: ?q= */
export const GET = route(async (me, req) => searchCatalog(me.email, new URL(req.url).searchParams.get("q") ?? ""));
