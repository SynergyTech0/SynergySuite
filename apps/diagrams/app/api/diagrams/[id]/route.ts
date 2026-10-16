import { type Params, body, route } from "@/lib/api";
import { get, remove, rename, save } from "@/lib/diagrams";

export const GET = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  return get(me.email, id, { open: new URL(req.url).searchParams.get("open") === "1" });
});

/** `{ xml, baseVersion, force? }` saves the drawing (and `name` with it); `{ name }` alone renames. */
export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const b = await body<{ xml?: unknown; name?: unknown; baseVersion?: unknown; force?: unknown }>(req);
  if (b.xml !== undefined) return save(me.email, id, { ...b, xml: b.xml });
  return rename(me.email, id, b.name);
});

/** The owner deletes it; anyone else takes it out of their lists. */
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  const { id } = await params;
  await remove(me.email, id);
  return { ok: true };
});
