import { body, route } from "@/lib/api";
import { type PageInput, createPage, myPages } from "@/lib/pages";

export const GET = route(async (me) => myPages(me));
export const POST = route(async (me, req) => createPage(me, await body<PageInput>(req)));
