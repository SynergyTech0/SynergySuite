import { route, type Params } from "@/lib/api";
import { getAudience, listSubscribers } from "@/lib/audiences";
import { toCsv } from "@/lib/csv";
import { assertCanEdit } from "@/lib/members";
import { label, type Subscriber } from "@/lib/types";

/** Everyone in the audience as CSV. Marketers and admins only: it is customers' details. */
export const GET = route(async (ctx, _req, { params }: Params<"id">) => {
  assertCanEdit(ctx);
  const a = await getAudience((await params).id);
  const all: Subscriber[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await listSubscribers(a.id, { limit: 500, offset });
    all.push(...page.items);
    if (page.items.length < 500) break;
  }
  const keys = [...new Set(all.flatMap((s) => Object.keys(s.fields)))].sort();
  const csv = toCsv(all, [
    ["Email", (s) => s.email], ["First name", (s) => s.firstName], ["Last name", (s) => s.lastName], ["Company", (s) => s.company],
    ["Status", (s) => label(s.status)], ["Tags", (s) => s.tags.join(", ")], ["Source", (s) => label(s.source)],
    ["Consent", (s) => s.consentAt ?? ""], ["Added", (s) => s.createdAt],
    ...keys.map((k): [string, (s: Subscriber) => unknown] => [k, (s) => s.fields[k] ?? ""]),
  ]);
  const name = a.name.replace(/[^\w.-]+/g, "-").slice(0, 60) || "audience";
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "X-Content-Type-Options": "nosniff" },
  });
});
