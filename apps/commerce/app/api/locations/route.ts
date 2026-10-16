import { body, route } from "@/lib/api";
import { locations, saveLocation } from "@/lib/catalog";

export const GET = route(async () => locations());
export const POST = route(async (ctx, req) => saveLocation(ctx, null, await body(req)));
