import { type Params, route } from "@/lib/api";
import { deleteFile, getFile } from "@/lib/workorders";

const INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/;

export const GET = route(async (me, _req, { params }: Params<"id" | "fileId">) => {
  const { id, fileId } = await params;
  const f = await getFile(me.email, id, fileId);
  const inline = INLINE.test(f.type);
  return new Response(new Uint8Array(f.data), {
    headers: {
      "content-type": inline ? f.type : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "cache-control": "private, max-age=300",
    },
  });
});

export const DELETE = route(async (me, _req, { params }: Params<"id" | "fileId">) => {
  const { id, fileId } = await params;
  await deleteFile(me.email, id, fileId);
});
