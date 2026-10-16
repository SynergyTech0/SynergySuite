import { body, route } from "@/lib/http";
import { createApp, listApps } from "@/lib/apps";
import { fromTable } from "@/lib/generate";
import { sourceName } from "@/lib/model";
import { getTable } from "@/lib/services";

export const GET = route(async (_req, me) => ({ apps: await listApps(me.email) }));

/**
 * POST `{ name, layout?: "tablet" | "phone", description?, fromTable?: tableId }` makes an app:
 * blank, or (fromTable) a browse, detail and edit app over that Base table.
 */
export const POST = route(async (req, me) => {
  const b = await body<{ name?: unknown; layout?: unknown; description?: unknown; fromTable?: unknown; color?: unknown }>(req);
  const layout = b.layout === "phone" ? "phone" : "tablet";
  let definition: unknown;
  let name = b.name;
  if (typeof b.fromTable === "string" && b.fromTable) {
    const t = await getTable(me.email, b.fromTable);
    definition = fromTable({ name: sourceName(t.name), kind: "base", databaseId: t.databaseId, tableId: t.id, tableName: t.name, fields: t.fields }, layout);
    name ??= t.name;
  }
  const app = await createApp(me.email, { name, layout, description: b.description, definition, color: b.color });
  return Response.json({ app }, { status: 201 });
});
