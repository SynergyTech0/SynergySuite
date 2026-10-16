import { route } from "@/lib/http";
import { listTables } from "@/lib/services";

/** A Base database's tables and their fields. */
export const GET = route<{ id: string }>(async (_req, me, { id }) => ({ tables: await listTables(me.email, id) }));
