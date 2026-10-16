import { body, route, type Params } from "@/lib/api";
import { receive } from "@/lib/purchasing";

export const POST = route(async (ctx, req, { params }: Params<"id">) => receive(ctx, (await params).id, await body(req)));
