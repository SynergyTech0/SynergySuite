import { body, route, type Params } from "@/lib/api";
import { deleteSource, detail, updateSource } from "@/lib/migrate";

export const GET = route("migrate", async (_me, _req, { params }: Params<"id">) => detail((await params).id));
/** Rename, or paste a new client secret (tested before it is kept). */
export const PATCH = route("migrate", async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  await updateSource(me, id, await body(req));
  return detail(id);
});
export const DELETE = route("migrate", async (me, _req, { params }: Params<"id">) => deleteSource(me, (await params).id));
