import { route, type Params } from "@/lib/api";
import { cancelPo } from "@/lib/purchasing";

export const POST = route(async (ctx, _req, { params }: Params<"id">) => cancelPo(ctx, (await params).id));
