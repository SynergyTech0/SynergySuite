import { route, type Params } from "@/lib/api";
import { stats } from "@/lib/sites";

export const GET = route(async (_me, req, { params }: Params<"id">) => stats((await params).id, new URL(req.url).searchParams.get("days")));
