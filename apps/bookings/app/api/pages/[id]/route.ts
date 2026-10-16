import { type Params, body, route } from "@/lib/api";
import { holdChecker } from "@/lib/compliance";
import { type PageInput, deletePage, pageFor, updatePage } from "@/lib/pages";

export const GET = route(async (me, _req, { params }: Params<"id">) => pageFor(me, (await params).id));
export const PATCH = route(async (me, req, { params }: Params<"id">) => updatePage(me, (await params).id, await body<PageInput>(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deletePage(me, (await params).id, holdChecker());
  return { ok: true };
});
