import { body, route } from "@/lib/api";
import { create, list } from "@/lib/diagrams";
import type { View } from "@/lib/types";

const VIEWS: View[] = ["recent", "mine", "shared"];

export const GET = route(async (me, req) => {
  const u = new URL(req.url);
  const v = u.searchParams.get("view") as View;
  return { diagrams: await list(me.email, { view: VIEWS.includes(v) ? v : "recent", query: u.searchParams.get("q") ?? "" }) };
});

/** A new diagram: blank, or from a template, an import or the AI (`xml`). */
export const POST = route(async (me, req) => {
  const b = await body<{ name?: string; xml?: string }>(req);
  return create(me.email, b);
});
