import { type Params, body, route } from "@/lib/api";
import { setThumbnail, thumbnail } from "@/lib/diagrams";

export const GET = route(async (me, _req, { params }: Params<"id">) => {
  const t = await thumbnail(me.email, (await params).id);
  if (!t) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(t.png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=0, must-revalidate", ETag: `"v${t.version}"` },
  });
});

/** `{ png }`: a data: URL the editor rendered after a save. */
export const PUT = route(async (me, req, { params }: Params<"id">) => {
  const b = await body<{ png?: string }>(req);
  await setThumbnail(me.email, (await params).id, b.png);
  return { ok: true };
});
