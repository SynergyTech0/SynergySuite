import { body, route } from "@/lib/api";
import { createComponent, myComponents } from "@/lib/loop";

export const GET = route(async (me) => ({ components: await myComponents(me) }));
export const POST = route(async (me, req) => createComponent(me, await body(req)));
