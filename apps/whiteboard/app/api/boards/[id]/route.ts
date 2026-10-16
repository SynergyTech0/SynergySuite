import { type Params, body, route } from "@/lib/api";
import * as boards from "@/lib/boards";

export const GET = route(async (me, _req, { params }: Params<"id">) => boards.getBoard(me, (await params).id, { visit: true }));

/** Rename, or change who the link lets in. */
export const PATCH = route(async (me, req, { params }: Params<"id">) => boards.updateBoard(me, (await params).id, await body(req)));

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await boards.deleteBoard(me, (await params).id);
  return { ok: true };
});
