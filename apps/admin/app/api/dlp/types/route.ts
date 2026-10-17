import { body, route } from "@/lib/api";
import { createType } from "@/lib/protection";

export const POST = route("protection", async (me, req) => createType(me, await body(req)));
