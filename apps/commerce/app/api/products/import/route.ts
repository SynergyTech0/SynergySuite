import { body, route } from "@/lib/api";
import { importProducts } from "@/lib/catalog";

export const POST = route(async (ctx, req) => importProducts(ctx, (await body<{ rows: Record<string, string>[] }>(req)).rows));
