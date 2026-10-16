import { route, type Params } from "@/lib/api";
import { software } from "@/lib/devices";

export const GET = route(async (me, req, { params }: Params<"id">) => software(me, (await params).id, new URL(req.url).searchParams.get("q") ?? ""));
