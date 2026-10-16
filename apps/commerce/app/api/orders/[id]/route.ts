import { route, type Params } from "@/lib/api";
import { order } from "@/lib/sales";

export const GET = route(async (_ctx, _req, { params }: Params<"id">) => order((await params).id));
