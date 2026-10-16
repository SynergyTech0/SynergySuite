import { body, route } from "@/lib/api";
import { saveVendor, vendors } from "@/lib/catalog";

export const GET = route(async () => vendors());
export const POST = route(async (ctx, req) => saveVendor(ctx, null, await body(req)));
