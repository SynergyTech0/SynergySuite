import { body, route } from "@/lib/api";
import { createPage } from "@/lib/loop";

export const POST = route(async (me, req) => createPage(me, await body(req)));
