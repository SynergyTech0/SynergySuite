import { route } from "@/lib/http";
import { importAccess } from "@/lib/access";
import { accessUpload } from "@/lib/accessForm";

/** POST (multipart `file`, `password?`) imports an Access database's tables into this database. */
export const POST = route<{ id: string }>(async (req, me, { id }) => {
  const { buffer, password } = await accessUpload(req);
  return Response.json(await importAccess(id, me.email, buffer, password), { status: 201 });
});
