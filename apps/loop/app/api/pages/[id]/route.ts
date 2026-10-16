import { type Params, body, route } from "@/lib/api";
import { deletePage, getPage, updatePage } from "@/lib/loop";

export const GET = route(async (me, _req, { params }: Params<"id">) => getPage(me, (await params).id));
export const PATCH = route(async (me, req, { params }: Params<"id">) => updatePage(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => deletePage(me, (await params).id));
