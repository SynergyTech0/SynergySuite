import { route, type Params } from "@/lib/api";
import { MAX_FILE_BYTES, addFile } from "@/lib/contracts";
import { UserError } from "@/lib/util";

/** Upload as multipart form data: `file`, and `kind` = attachment or executed (the signed copy). */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw new UserError("Choose a file");
  if (file.size > MAX_FILE_BYTES) throw new UserError("Files can be up to 25 MB");
  return addFile(me, (await params).id, {
    name: file.name,
    type: file.type,
    bytes: Buffer.from(await file.arrayBuffer()),
    kind: String(form?.get("kind") ?? "attachment"),
  });
});
