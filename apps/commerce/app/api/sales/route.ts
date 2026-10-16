import { body, route } from "@/lib/api";
import { registerSale } from "@/lib/sales";

/** A sale rung up at the register. */
export const POST = route(async (ctx, req) => registerSale(ctx, await body(req)));
