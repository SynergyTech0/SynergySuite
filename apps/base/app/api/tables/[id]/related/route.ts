import { route } from "@/lib/http";
import { getTable, relationsTo } from "@/lib/catalog";

/** The lookup fields that point at this table: the subdatasheets a record can open. */
export const GET = route<{ id: string }>(async (_req, me, { id }) => {
  await getTable(id, me.email);
  return { relations: await relationsTo(id) };
});
