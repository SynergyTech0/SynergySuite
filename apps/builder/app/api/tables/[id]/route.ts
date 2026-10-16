import { route } from "@/lib/http";
import { getTable } from "@/lib/services";

/** One Base table's current fields, so the studio can catch up with renames. */
export const GET = route<{ id: string }>(async (_req, me, { id }) => ({ table: await getTable(me.email, id) }));
