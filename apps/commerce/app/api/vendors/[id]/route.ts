import { body, route, type Params } from "@/lib/api";
import { saveVendor } from "@/lib/catalog";

export const PUT = route(async (ctx, req, { params }: Params<"id">) => saveVendor(ctx, (await params).id, await body(req)));
