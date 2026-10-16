import { route } from "@/lib/http";
import { getTable } from "@/lib/catalog";
import { csvHeaders, tableCsv } from "@/lib/exportCsv";
import { parseSpec, type FilterSpec, type SortSpec } from "@/lib/filter";

/** GET ?q&filter&sort downloads the records a datasheet shows, as CSV. */
export const GET = route<{ id: string }>(async (req, me, { id }) => {
  const t = await getTable(id, me.email);
  const sp = new URL(req.url).searchParams;
  const opts = { search: sp.get("q"), filter: parseSpec<FilterSpec>(sp.get("filter")), sort: parseSpec<SortSpec>(sp.get("sort")) };
  return new Response(tableCsv(t, opts), { headers: csvHeaders(t.name) });
});
