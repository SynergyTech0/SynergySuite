import { body, route } from "@/lib/api";
import { create, list } from "@/lib/canned";

export const GET = route(async () => list());

export const POST = route(async (me, req) => create(me.email, await body(req)));
