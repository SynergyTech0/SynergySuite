import { type Params, route } from "@/lib/api";
import { listDocuments, uploadDocument } from "@/lib/documents";
import { UserError } from "@/lib/util";

export const GET = route(async (me, _req, { params }: Params<"id">) => listDocuments(me, (await params).id));
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new UserError("Choose a file");
  return uploadDocument(me, (await params).id, file);
});
