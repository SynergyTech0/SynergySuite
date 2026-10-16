import { body, route } from "@/lib/api";
import { adjust } from "@/lib/stock";

export const POST = route(async (ctx, req) => adjust(ctx, await body(req)));
