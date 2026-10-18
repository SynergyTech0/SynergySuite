import { body, requireAdmin, route } from "@/lib/api";
import { createWidget, listWidgets, snippet } from "@/lib/widgets";

export const GET = route(async () => ({ widgets: (await listWidgets()).map((w) => ({ ...w, snippet: snippet(w.widget_key) })) }));

export const POST = route(async (me, req) => {
  requireAdmin(me);
  const w = await createWidget(me.email, await body(req));
  return { widget: { ...w, snippet: snippet(w.widget_key) } };
});
