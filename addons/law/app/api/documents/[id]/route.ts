import { type Params, route } from "@/lib/api";
import { deleteDocument, getDocument } from "@/lib/documents";

export const GET = route(async (me, _req, { params }: Params<"id">) => getDocument(me, (await params).id));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteDocument(me, (await params).id);
  return { ok: true };
});
