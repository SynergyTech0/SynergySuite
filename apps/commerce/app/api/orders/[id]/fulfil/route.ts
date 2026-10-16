import { body, route, type Params } from "@/lib/api";
import { fulfil } from "@/lib/sales";

export const POST = route(async (ctx, req, { params }: Params<"id">) => fulfil(ctx, (await params).id, (await body<{ step?: string }>(req)).step));
