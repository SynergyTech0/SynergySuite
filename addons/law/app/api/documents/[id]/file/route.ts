import { type Params, route } from "@/lib/api";
import { documentBytes } from "@/lib/documents";

/** The file itself, downloaded rather than shown, so nothing in it runs on this site. */
export const GET = route(async (me, _req, { params }: Params<"id">) => {
  const d = await documentBytes(me, (await params).id);
  return new Response(new Uint8Array(d.bytes), {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(d.name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
});
