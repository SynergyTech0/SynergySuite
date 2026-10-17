import { body, route } from "@/lib/api";
import { saveAsset } from "@/lib/customers";

export const POST = route(async (me, req) => saveAsset(me.email, null, await body(req)));
