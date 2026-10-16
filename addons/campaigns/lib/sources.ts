/**
 * Filling audiences from the rest of the suite. CRM (contacts or leads, with the CRM's own
 * filters) and Contacts (one of your contact groups) are asked over the internal network as the
 * person importing, the way the gateway would ask, so each app hands over only what that person
 * may see there. An import can stay synced: the audience is refreshed from the same source, as
 * the same person, before each campaign to it goes out. Syncing adds and updates people; it never
 * removes anyone, and never resubscribes anyone who left (lib/audiences.ts upsertMany).
 */
import { getAudience, upsertMany, type Incoming, type UpsertResult } from "./audiences";
import { q } from "./db";
import { assertCanEdit } from "./members";
import { SOURCE_KINDS, type AudienceSource, type Ctx, type SourceKind } from "./types";
import { UserError, isUuid, oneOf, tags as cleanTags, text } from "./util";

function internal(envName: string, service: string, port: number): string {
  const v = process.env[envName];
  if (v) return v.replace(/\/$/, "");
  return process.env.NODE_ENV === "production" ? `http://${service}:${port}` : `http://localhost:${port}`;
}

const crmUrl = () => internal("CRM_INTERNAL_URL", "crm", 3095);
const contactsUrl = () => internal("CONTACTS_INTERNAL_URL", "contacts", 3190);

/** Calls another suite app as `email`, the way the gateway would. */
async function asPerson(app: "CRM" | "Contacts", email: string, path: string): Promise<unknown> {
  const base = app === "CRM" ? crmUrl() : contactsUrl();
  const headers: Record<string, string> = { "x-auth-request-email": email };
  if (process.env.PROXY_SHARED_SECRET) headers["x-proxy-auth-secret"] = process.env.PROXY_SHARED_SECRET;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new UserError(`Couldn't reach ${app}. Is it running?`, 502);
  }
  if (!res.ok) throw new UserError(`${app} answered ${res.status}`, 502);
  return res.json();
}

const titled = (t?: string): Record<string, string> => (t ? { title: t } : {});

function split(name: string): { firstName: string; lastName: string } {
  const [firstName = "", ...rest] = String(name ?? "").trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
}

export function cleanParams(kind: SourceKind, v: unknown): Record<string, string> {
  const b = (v ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  const keep = kind === "contacts_group" ? ["group", "groupName"] : kind === "crm_leads" ? ["q", "status", "source", "mine"] : ["q", "accountId", "mine"];
  for (const k of keep) if (b[k] !== undefined && b[k] !== null && String(b[k]).trim()) out[k] = text(b[k], 200);
  if (kind === "contacts_group" && !isUuid(out.group)) throw new UserError("Pick a contact group");
  return out;
}

type CrmContact = { name: string; email: string; title: string; accountName: string };
type CrmLead = { name: string; email: string; company: string; status: string; source: string; score: number | null };
type PersonalContact = { firstName: string; lastName: string; company: string; jobTitle: string; emails: { value: string }[] };

/** The people a source holds, as `email` sees them. */
export async function fetchSource(email: string, kind: SourceKind, params: Record<string, string>): Promise<Incoming[]> {
  const qs = new URLSearchParams(params);
  if (kind === "crm_contacts") {
    const list = (await asPerson("CRM", email, `/api/contacts?${qs}`)) as CrmContact[];
    return (Array.isArray(list) ? list : []).filter((c) => c.email).map((c) => ({
      email: c.email, ...split(c.name), company: c.accountName ?? "", fields: titled(c.title),
      tags: ["crm"], source: "crm_contact",
    }));
  }
  if (kind === "crm_leads") {
    const list = (await asPerson("CRM", email, `/api/leads?${qs}`)) as CrmLead[];
    return (Array.isArray(list) ? list : []).filter((l) => l.email).map((l) => ({
      email: l.email, ...split(l.name), company: l.company ?? "",
      fields: { lead_status: l.status, lead_source: l.source, ...(l.score !== null && l.score !== undefined ? { lead_score: String(l.score) } : {}) },
      tags: ["lead"], source: "crm_lead",
    }));
  }
  const list = (await asPerson("Contacts", email, `/api/contacts?${new URLSearchParams({ group: params.group })}`)) as PersonalContact[];
  const tag = cleanTags([params.groupName ?? ""]);
  return (Array.isArray(list) ? list : []).filter((c) => c.emails?.[0]?.value).map((c) => ({
    email: c.emails[0].value, firstName: c.firstName ?? "", lastName: c.lastName ?? "", company: c.company ?? "",
    fields: titled(c.jobTitle), tags: tag, source: "contacts",
  }));
}

/** The signed-in person's contact groups, to pick one to import. */
export async function contactGroups(ctx: Ctx): Promise<{ id: string; name: string; count: number }[]> {
  const list = (await asPerson("Contacts", ctx.email, "/api/groups")) as { id: string; name: string; count: number }[];
  return Array.isArray(list) ? list : [];
}

export async function previewSource(ctx: Ctx, kindRaw: unknown, paramsRaw: unknown): Promise<{ count: number; sample: { email: string; name: string }[] }> {
  const kind = oneOf(kindRaw, SOURCE_KINDS, "crm_contacts", "source");
  const people = await fetchSource(ctx.email, kind, cleanParams(kind, paramsRaw));
  return { count: people.length, sample: people.slice(0, 5).map((p) => ({ email: p.email, name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() })) };
}

function describe(kind: SourceKind, p: Record<string, string>): string {
  if (kind === "contacts_group") return `Contacts group "${p.groupName || "?"}"`;
  const bits = [p.status && `status ${p.status}`, p.source && `source ${p.source}`, p.q && `matching "${p.q}"`, p.mine && "mine only"].filter(Boolean);
  return `${kind === "crm_leads" ? "CRM leads" : "CRM contacts"}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}

/** Imports once, and with `keepSynced` remembers the source for refreshes. */
export async function importFrom(ctx: Ctx, audienceId: string, b: Record<string, unknown>): Promise<UpsertResult & { sourceId?: string }> {
  assertCanEdit(ctx);
  await getAudience(audienceId);
  const kind = oneOf(b.kind, SOURCE_KINDS, "crm_contacts", "source");
  const params = cleanParams(kind, b.params);
  const extra = cleanTags(b.tags);
  const people = (await fetchSource(ctx.email, kind, params)).map((p) => ({ ...p, tags: [...(p.tags ?? []), ...extra] }));
  const res = await upsertMany(ctx.email, audienceId, people);
  if (!b.keepSynced) return res;
  const [row] = await q<{ id: string }>(
    `INSERT INTO audience_sources (audience_id, kind, params, label, owner, last_sync_at, last_result)
     VALUES ($1, $2, $3::jsonb, $4, $5, now(), $6) RETURNING id`,
    [audienceId, kind, JSON.stringify({ ...params, ...(extra.length ? { tags: extra.join(",") } : {}) }), describe(kind, params), ctx.email, summary(res)],
  );
  return { ...res, sourceId: row.id };
}

const summary = (r: UpsertResult) => `${r.added} added, ${r.updated} updated${r.invalid.length ? `, ${r.invalid.length} invalid` : ""}`;

type SourceRow = { id: string; audience_id: string; kind: SourceKind; params: Record<string, string>; label: string; owner: string; last_sync_at: Date | null; last_result: string };
const toSource = (r: SourceRow): AudienceSource => ({
  id: r.id, audienceId: r.audience_id, kind: r.kind, params: r.params, label: r.label, owner: r.owner,
  lastSyncAt: r.last_sync_at ? new Date(r.last_sync_at).toISOString() : null, lastResult: r.last_result,
});

export async function listSources(audienceId: string): Promise<AudienceSource[]> {
  return (await q<SourceRow>("SELECT * FROM audience_sources WHERE audience_id = $1 ORDER BY created_at", [audienceId])).map(toSource);
}

export async function deleteSource(ctx: Ctx, id: string): Promise<void> {
  assertCanEdit(ctx);
  if (!isUuid(id)) throw new UserError("Not found", 404);
  await q("DELETE FROM audience_sources WHERE id = $1", [id]);
}

/** Refreshes every synced source of an audience; one that fails says why and the rest carry on. */
export async function syncAudience(audienceId: string): Promise<AudienceSource[]> {
  const sources = await q<SourceRow>("SELECT * FROM audience_sources WHERE audience_id = $1", [audienceId]);
  for (const s of sources) {
    let result: string;
    try {
      const { tags: extra, ...params } = s.params;
      const people = (await fetchSource(s.owner, s.kind, params)).map((p) => ({ ...p, tags: [...(p.tags ?? []), ...cleanTags(extra ?? "")] }));
      result = summary(await upsertMany(s.owner, audienceId, people));
    } catch (e) {
      result = `Failed: ${(e as Error).message}`.slice(0, 300);
    }
    await q("UPDATE audience_sources SET last_sync_at = now(), last_result = $2 WHERE id = $1", [s.id, result]);
  }
  return listSources(audienceId);
}
