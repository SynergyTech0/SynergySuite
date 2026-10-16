import { body, route } from "@/lib/api";
import { transfer } from "@/lib/stock";

export const POST = route(async (ctx, req) => transfer(ctx, await body(req)));
