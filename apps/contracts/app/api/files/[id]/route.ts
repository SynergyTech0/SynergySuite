import { route, type Params } from "@/lib/api";
import { deleteFile, getFile } from "@/lib/contracts";

export const GET = route(async (me, _req, { params }: Params<"id">) => {
  const f = await getFile(me, (await params).id);
  return new Response(new Uint8Array(f.bytes), {
    headers: {
      "content-type": f.type,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
    },
  });
});
export const DELETE = route(async (me, _req, { params }: Params<"id">) => deleteFile(me, (await params).id));
