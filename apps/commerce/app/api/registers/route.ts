import { body, route } from "@/lib/api";
import { registers, saveRegister } from "@/lib/sales";

export const GET = route(async () => registers());
export const POST = route(async (ctx, req) => saveRegister(ctx, null, await body(req)));
