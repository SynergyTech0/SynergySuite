import { body, route, type Params } from "@/lib/api";
import { share, unshare } from "@/lib/contracts";

export const POST = route(async (me, req, { params }: Params<"id">) => share(me, (await params).id, await body(req)));
export const DELETE = route(async (me, req, { params }: Params<"id">) => unshare(me, (await params).id, new URL(req.url).searchParams.get("email") ?? ""));
