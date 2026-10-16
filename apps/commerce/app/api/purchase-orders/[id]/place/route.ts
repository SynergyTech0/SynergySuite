import { route, type Params } from "@/lib/api";
import { placePo } from "@/lib/purchasing";

export const POST = route(async (ctx, _req, { params }: Params<"id">) => placePo(ctx, (await params).id));
