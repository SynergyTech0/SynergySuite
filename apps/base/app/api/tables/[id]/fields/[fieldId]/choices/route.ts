import { notFound, route } from "@/lib/http";
import { getTable } from "@/lib/catalog";
import { lookupChoices } from "@/lib/rows";

/** GET ?q= lists the records a lookup field can point at, as { id, label }. */
export const GET = route<{ id: string; fieldId: string }>(async (req, me, { id, fieldId }) => {
  const t = await getTable(id, me.email);
  const f = t.fields.find((x) => x.id === fieldId);
  if (!f) throw notFound();
  return { choices: await lookupChoices(t, f, new URL(req.url).searchParams.get("q") ?? "") };
});
