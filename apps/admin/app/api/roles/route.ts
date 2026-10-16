import { body, route } from "@/lib/api";
import { grant, list } from "@/lib/roles";

export const GET = route("roles", async () => list());
export const POST = route("roles", async (me, req) => grant(me, await body(req)));
