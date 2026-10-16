import { type Params, body, route } from "@/lib/api";
import * as drive from "@/lib/drive";

export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  await drive.updateLibrary(me, (await params).id, await body(req));
  return { ok: true };
});

export const DELETE = route(async (me, _req, { params }: Params<"id">) => drive.deleteLibrary(me, (await params).id));
