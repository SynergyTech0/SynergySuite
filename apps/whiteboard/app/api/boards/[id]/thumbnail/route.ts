import { type Params, body, route } from "@/lib/api";
import * as boards from "@/lib/boards";

export const GET = route(async (me, _req, { params }: Params<"id">) => {
  const png = await boards.thumbnail(me, (await params).id);
  if (!png) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "private, max-age=30" } });
});

/** A small picture of the board for the board list: { dataUrl: "data:image/png;base64,..." }. */
export const PUT = route(async (me, req, { params }: Params<"id">) => {
  const b = await body<{ dataUrl?: string }>(req);
  await boards.setThumbnail(me, (await params).id, b.dataUrl);
  return { ok: true };
});
