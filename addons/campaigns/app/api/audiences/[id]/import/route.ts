import { body, route, type Params } from "@/lib/api";
import { getAudience, upsertMany } from "@/lib/audiences";
import { csvPeople } from "@/lib/csv";
import { assertCanEdit } from "@/lib/members";
import { importFrom } from "@/lib/sources";
import { UserError, tags as cleanTags } from "@/lib/util";

/**
 * Adds people from a CSV ({ kind: "csv", csv, tags }) or from CRM or Contacts
 * ({ kind: "crm_contacts" | "crm_leads" | "contacts_group", params, keepSynced, tags }).
 */
export const POST = route(async (ctx, req, { params }: Params<"id">) => {
  const id = (await params).id;
  const b = await body<Record<string, unknown>>(req);
  if (b.kind !== "csv") return importFrom(ctx, id, b);
  assertCanEdit(ctx);
  await getAudience(id);
  const csv = typeof b.csv === "string" ? b.csv : "";
  if (!csv.trim()) throw new UserError("The file is empty");
  if (csv.length > 20_000_000) throw new UserError("Import at most 20 MB at a time");
  const extra = cleanTags(b.tags);
  const people = csvPeople(csv).slice(0, 100_000);
  return upsertMany(ctx.email, id, people.map((p) => ({ ...p, tags: [...p.tags, ...extra], source: "csv" })));
});
