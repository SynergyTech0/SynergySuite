import { route } from "@/lib/http";
import { importAccess } from "@/lib/access";
import { createDatabase, deleteDatabase } from "@/lib/catalog";
import { accessUpload } from "@/lib/accessForm";

/** POST (multipart `file`, `password?`) makes a new database from an Access file, named after it. */
export const POST = route(async (req, me) => {
  const { name, buffer, password } = await accessUpload(req);
  const database = await createDatabase(me.email, { name });
  try {
    const result = await importAccess(database.id, me.email, buffer, password);
    return Response.json({ database, ...result }, { status: 201 });
  } catch (e) {
    await deleteDatabase(database.id, me.email).catch(() => {});
    throw e;
  }
});
