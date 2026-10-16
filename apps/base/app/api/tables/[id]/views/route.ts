import { body, route } from "@/lib/http";
import { getListViews, saveListViews } from "@/lib/listViews";

type P = { id: string };

/** GET the table's gallery, board and calendar settings. */
export const GET = route<P>(async (_req, me, { id }) => ({ settings: await getListViews(id, me.email) }));

/** PUT `{ settings }` saves them. */
export const PUT = route<P>(async (req, me, { id }) => {
  const b = await body<{ settings?: unknown }>(req);
  return { settings: await saveListViews(id, me.email, b.settings) };
});
