import { type Params, route } from "@/lib/api";
import { UserError } from "@/lib/util";
import { MAX_FILE, addFile } from "@/lib/workorders";

/** A photo or document from the job, as multipart form field `file`. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FILE + 64 * 1024) throw new UserError("Files can be up to 15 MB", 413);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw new UserError("Choose a file");
  return addFile(me.email, (await params).id, { name: file.name, type: file.type, data: Buffer.from(await file.arrayBuffer()) });
});
