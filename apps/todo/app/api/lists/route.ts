import { body, route } from "@/lib/api";
import { counts, createList, lists } from "@/lib/todo";

/** The sidebar: every list, and the smart lists' counts for the browser's today. */
export const GET = route(async (me, req) => {
  const today = new URL(req.url).searchParams.get("today") ?? "";
  const all = await lists(me.email);
  return { lists: all, counts: await counts(me.email, today) };
});

export const POST = route(async (me, req) => {
  const b = await body<{ name?: string; color?: string }>(req);
  return createList(me.email, b.name, b.color);
});
