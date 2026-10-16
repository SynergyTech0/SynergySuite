import { body, route } from "@/lib/api";
import { createGroup, groups } from "@/lib/contacts";

export const GET = route(async (me) => groups(me.email));

export const POST = route(async (me, req) => createGroup(me.email, String((await body<{ name?: string }>(req)).name ?? "")));
