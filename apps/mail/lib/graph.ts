import { q } from "./db";

/**
 * Microsoft 365 mailboxes opened through Microsoft Graph with an organization's own app
 * registration (application permissions Mail.ReadWrite and Mail.Send, granted by its admin), so
 * nobody signs in and MFA or disabled IMAP don't get in the way. That app can open every mailbox
 * in its organization, so which suite user sees which mailbox is decided here, by the admin:
 *
 *   MAIL_GRAPH_TENANT / _CLIENT_ID / _CLIENT_SECRET   the app registration
 *   MAIL_GRAPH_MAILBOXES  "suite user=mailbox" pairs, comma separated, e.g.
 *                         "shane@suite.example=shane@company.com,shane@suite.example=support@company.com"
 *   MAIL_GRAPH_DOMAINS    domains where a suite user also gets the mailbox with their own address
 *
 * Message ids are Graph's immutable ids (they survive moves); the browser gets numeric uids for
 * them from graph_uids, like IMAP UIDs. Folder paths are Graph folder ids.
 */

type Env = Record<string, string | undefined>;
export type GraphConfig = { tenant: string; clientId: string; clientSecret: string };

export function graphConfig(env: Env = process.env): GraphConfig | null {
  const { MAIL_GRAPH_TENANT: tenant, MAIL_GRAPH_CLIENT_ID: clientId, MAIL_GRAPH_CLIENT_SECRET: clientSecret } = env;
  return tenant && clientId && clientSecret ? { tenant, clientId, clientSecret } : null;
}

/** The Graph mailboxes this suite user may open, in the order the admin listed them. */
export function graphMailboxesOf(user: string, env: Env = process.env): string[] {
  if (!graphConfig(env)) return [];
  const me = user.toLowerCase();
  const out: string[] = [];
  for (const pair of (env.MAIL_GRAPH_MAILBOXES || "").split(",")) {
    const [owner, mailbox] = pair.split("=").map((s) => s?.trim().toLowerCase());
    if (owner === me && mailbox && /^[^@\s]+@[^@\s]+$/.test(mailbox)) out.push(mailbox);
  }
  const domains = (env.MAIL_GRAPH_DOMAINS || "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (domains.includes(me.slice(me.lastIndexOf("@") + 1))) out.push(me);
  return [...new Set(out)];
}

// ---------- requests ----------

let token: { value: string; expiresAt: number; key: string } | null = null;

async function appToken(c: GraphConfig): Promise<string> {
  const key = `${c.tenant}\n${c.clientId}`;
  if (token && token.key === key && token.expiresAt - 5 * 60 * 1000 > Date.now()) return token.value;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(c.tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !body.access_token) throw new GraphError(`Microsoft refused the mail app: ${firstLine(body.error_description) || body.error || res.status}`, 502);
  token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000, key };
  return token.value;
}

const firstLine = (s?: string) => (s || "").split(/\r?\n/)[0].replace(/^AADSTS\d+:\s*/, "").trim();

export class GraphError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/* Exchange lets one app have only 4 requests open per mailbox and answers the 5th with 429
   ("MailboxConcurrency"); a folder list alone asks for 6 at once. So calls to a mailbox wait their
   turn, keeping one slot free for anything else using the same app, and throttled ones are retried. */
const PER_MAILBOX = 3;
const RETRIES = 4;
const MAX_WAIT_MS = 20_000;
const turns = new Map<string, { running: number; waiting: (() => void)[] }>();

async function inTurn<T>(mailbox: string, fn: () => Promise<T>): Promise<T> {
  const key = mailbox.toLowerCase();
  let t = turns.get(key);
  if (!t) turns.set(key, (t = { running: 0, waiting: [] }));
  if (t.running >= PER_MAILBOX) await new Promise<void>((go) => t!.waiting.push(go));
  else t.running++;
  try {
    return await fn();
  } finally {
    const next = t.waiting.shift();
    if (next) next(); // the slot passes straight to the next caller
    else if (--t.running === 0) turns.delete(key);
  }
}

/** fetch, retrying 429 and 503 after the Retry-After Microsoft gives (or a growing pause). */
async function fetchPatiently(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if ((res.status !== 429 && res.status !== 503) || attempt >= RETRIES) return res;
    const after = Number(res.headers.get("retry-after"));
    const wait = Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** attempt, MAX_WAIT_MS);
    await res.body?.cancel().catch(() => undefined);
    await new Promise((r) => setTimeout(r, wait));
  }
}

type Init = { method?: string; body?: unknown; raw?: string; contentType?: string; search?: boolean };

/** One Graph call for a mailbox. path starts after /users/<mailbox>. */
export async function graph<T = unknown>(mailbox: string, path: string, init: Init = {}, c = graphConfig()): Promise<T> {
  if (!c) throw new GraphError("Microsoft Graph mail isn't set up on this server", 503);
  const headers: Record<string, string> = { authorization: `Bearer ${await appToken(c)}`, prefer: 'IdType="ImmutableId"' };
  let body: string | undefined;
  if (init.raw !== undefined) {
    headers["content-type"] = init.contentType ?? "text/plain";
    body = init.raw;
  } else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  if (init.search) headers["consistencylevel"] = "eventual";
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}${path}`;
  const res = await inTurn(mailbox, () => fetchPatiently(url, { method: init.method ?? "GET", headers, body }));
  if (res.status === 204 || res.status === 202) return undefined as T;
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    const status = res.status === 404 ? 404 : res.status === 403 || res.status === 401 ? 403 : 502;
    const why = err.error?.message || err.error?.code || `HTTP ${res.status}`;
    throw new GraphError(status === 403 ? `Microsoft didn't let the mail app open ${mailbox}: ${why}` : `Microsoft Graph: ${why}`, status);
  }
  const type = res.headers.get("content-type") || "";
  return (type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer())) as T;
}

// ---------- uids ----------

/** Numeric uids for Graph message ids, in the same order. */
export async function uidsFor(mailbox: string, ids: string[]): Promise<number[]> {
  if (!ids.length) return [];
  const rows = await q<{ uid: string; graph_id: string }>(
    `INSERT INTO graph_uids (mailbox, graph_id) SELECT $1, unnest($2::text[])
     ON CONFLICT (mailbox, graph_id) DO UPDATE SET mailbox = EXCLUDED.mailbox RETURNING uid, graph_id`,
    [mailbox, ids],
  );
  const byId = new Map(rows.map((r) => [r.graph_id, Number(r.uid)]));
  return ids.map((id) => byId.get(id)!);
}

/** Graph ids for uids of this mailbox; unknown uids are left out. */
export async function idsFor(mailbox: string, uids: number[]): Promise<string[]> {
  if (!uids.length) return [];
  const rows = await q<{ uid: string; graph_id: string }>("SELECT uid, graph_id FROM graph_uids WHERE mailbox = $1 AND uid = ANY($2::bigint[])", [mailbox, uids]);
  const byUid = new Map(rows.map((r) => [Number(r.uid), r.graph_id]));
  return uids.map((u) => byUid.get(u)).filter((id): id is string => Boolean(id));
}

export async function idFor(mailbox: string, uid: number): Promise<string> {
  const [id] = await idsFor(mailbox, [uid]);
  if (!id) throw new GraphError("That message no longer exists", 404);
  return id;
}

// ---------- folders ----------

type GraphFolder = { id: string; displayName: string; childFolderCount: number; unreadItemCount: number; totalItemCount: number };
export type GraphFolderRow = { path: string; name: string; role: string | null; unread: number; total: number; depth: number };

const WELL_KNOWN: Record<string, string> = {
  inbox: "\\Inbox", drafts: "\\Drafts", sentitems: "\\Sent", deleteditems: "\\Trash", junkemail: "\\Junk", archive: "\\Archive",
};
const FOLDER_FIELDS = "$select=id,displayName,childFolderCount,unreadItemCount,totalItemCount&$top=250";

/** The well-known folders' ids, by role ("\\Inbox" → id). Archive may not exist. */
export async function roleIds(mailbox: string): Promise<Map<string, string>> {
  const found = await Promise.all(Object.entries(WELL_KNOWN).map(async ([name, role]) => {
    const f = await graph<{ id: string }>(mailbox, `/mailFolders/${name}?$select=id`).catch(() => null);
    return f ? ([role, f.id] as const) : null;
  }));
  return new Map(found.filter((x): x is readonly [string, string] => Boolean(x)));
}

export async function listGraphFolders(mailbox: string): Promise<GraphFolderRow[]> {
  const roles = await roleIds(mailbox);
  const roleOf = new Map([...roles].map(([role, id]) => [id, role]));
  const out: GraphFolderRow[] = [];
  const walk = async (path: string, depth: number) => {
    const page = await graph<{ value: GraphFolder[] }>(mailbox, `${path}?${FOLDER_FIELDS}`);
    for (const f of page.value) {
      out.push({ path: f.id, name: f.displayName, role: roleOf.get(f.id) ?? null, unread: f.unreadItemCount, total: f.totalItemCount, depth });
      if (f.childFolderCount > 0 && depth < 4) await walk(`/mailFolders/${encodeURIComponent(f.id)}/childFolders`, depth + 1);
    }
  };
  await walk("/mailFolders", 0);
  return out;
}

export async function createGraphFolder(mailbox: string, name: string): Promise<string> {
  return (await graph<{ id: string }>(mailbox, "/mailFolders", { method: "POST", body: { displayName: name } })).id;
}

// ---------- messages ----------

type Address = { emailAddress?: { name?: string; address?: string } };
export type GraphMessage = {
  id: string; subject?: string; from?: Address; toRecipients?: Address[]; receivedDateTime?: string;
  isRead?: boolean; flag?: { flagStatus?: string }; hasAttachments?: boolean;
};
const MESSAGE_FIELDS = "id,subject,from,toRecipients,receivedDateTime,isRead,flag,hasAttachments";

export const toPerson = (a?: Address) => ({ name: a?.emailAddress?.name || "", address: a?.emailAddress?.address || "" });

/** One page of a folder, newest first. With a search term, Graph's own search (no paging past 250). */
export async function listGraphMessages(
  mailbox: string, folder: string, page: number, pageSize: number, search?: string,
): Promise<{ total: number; messages: GraphMessage[] }> {
  const base = `/mailFolders/${encodeURIComponent(folder)}/messages?$select=${MESSAGE_FIELDS}`;
  if (search) {
    const term = search.replace(/["\\]/g, " ").trim();
    const top = Math.min((page + 1) * pageSize, 250);
    const r = await graph<{ value: GraphMessage[] }>(mailbox, `${base}&$top=${top}&$search=${encodeURIComponent(`"${term}"`)}`, { search: true });
    return { total: r.value.length, messages: r.value.slice(page * pageSize, (page + 1) * pageSize) };
  }
  const r = await graph<{ value: GraphMessage[]; "@odata.count"?: number }>(
    mailbox, `${base}&$top=${pageSize}&$skip=${page * pageSize}&$orderby=receivedDateTime desc&$count=true`,
  );
  return { total: r["@odata.count"] ?? r.value.length, messages: r.value };
}

export async function getGraphMessage(mailbox: string, id: string): Promise<GraphMessage> {
  return graph<GraphMessage>(mailbox, `/messages/${encodeURIComponent(id)}?$select=${MESSAGE_FIELDS}`);
}

/** The message as MIME, for the same parsing and sanitizing as IMAP mail. */
export async function getGraphMime(mailbox: string, id: string): Promise<Buffer> {
  return graph<Buffer>(mailbox, `/messages/${encodeURIComponent(id)}/$value`);
}

export async function patchGraphMessage(mailbox: string, id: string, body: Record<string, unknown>): Promise<void> {
  await graph(mailbox, `/messages/${encodeURIComponent(id)}`, { method: "PATCH", body });
}

export async function moveGraphMessage(mailbox: string, id: string, destinationId: string): Promise<void> {
  await graph(mailbox, `/messages/${encodeURIComponent(id)}/move`, { method: "POST", body: { destinationId } });
}

export async function deleteGraphMessage(mailbox: string, id: string): Promise<void> {
  await graph(mailbox, `/messages/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Sends a complete MIME message; Exchange files it in Sent Items. */
export async function sendGraphMime(mailbox: string, raw: Buffer): Promise<void> {
  await graph(mailbox, "/sendMail", { method: "POST", raw: raw.toString("base64"), contentType: "text/plain" });
}
