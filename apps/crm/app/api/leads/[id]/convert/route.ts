import { body, route, type Params } from "@/lib/api";
import * as leads from "@/lib/leads";

export const POST = route(async (ctx, req, { params }: Params<"id">) => leads.convert(ctx, (await params).id, await body(req)));
