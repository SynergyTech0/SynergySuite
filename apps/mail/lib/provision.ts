import { randomBytes } from "node:crypto";
import { UserError } from "./accounts";

/**
 * Creates a suite user's mailbox on Stalwart the first time they open Mail, through Stalwart's
 * JMAP management API. Turned on by MAIL_ADMIN_URL (e.g. http://stalwart:8080) with an admin
 * login in MAIL_ADMIN_USER / MAIL_ADMIN_PASSWORD. Without it, mailboxes must already exist.
 *
 * The mailbox gets a random password nobody is told: Mail opens it with the master login, and a
 * user who wants a desktop or phone client can be given an app password later.
 */
const known = new Set<string>();

export async function ensureMailbox(email: string, name: string): Promise<void> {
  const url = process.env.MAIL_ADMIN_URL;
  if (!url || known.has(email)) return;
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  const domainId = await first("x:Domain/query", { filter: { name: domain } });
  if (!domainId) throw new UserError(`This suite's mail server doesn't host ${domain} addresses`, 403);
  if (!(await first("x:Account/query", { filter: { name: local, domainId } }))) {
    const res = await call(url, [["x:Account/set", {
      create: {
        u: {
          "@type": "User", name: local, domainId, description: name || email,
          credentials: { "0": { "@type": "Password", secret: randomBytes(24).toString("base64url") } },
        },
      },
    }, "c"]]);
    const created = res?.created?.u;
    // Two first visits at once: the other request created it, which is fine.
    if (!created && !(await first("x:Account/query", { filter: { name: local, domainId } }))) {
      console.error("[mail] could not create mailbox", email, JSON.stringify(res?.notCreated ?? res));
      throw new UserError("Couldn't create your mailbox. Ask your administrator to check the mail server.", 502);
    }
  }
  known.add(email);

  async function first(method: string, args: object): Promise<string | undefined> {
    const r = await call(url!, [[method, args, "q"]]);
    return r?.ids?.[0];
  }
}

/** One JMAP request to Stalwart's admin API; the first method response's arguments. */
export async function call(url: string, methodCalls: unknown[]) {
  const auth = Buffer.from(`${process.env.MAIL_ADMIN_USER || "admin"}:${process.env.MAIL_ADMIN_PASSWORD || ""}`).toString("base64");
  const res = await fetch(`${url.replace(/\/$/, "")}/jmap/`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: JSON.stringify({ using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"], methodCalls }),
    cache: "no-store",
  }).catch((err) => {
    console.error("[mail] mail server admin API unreachable", err);
    throw new UserError("The mail server isn't reachable right now", 502);
  });
  if (!res.ok) {
    console.error("[mail] mail server admin API", res.status, await res.text().catch(() => ""));
    throw new UserError("The mail server refused Mail's admin login", 502);
  }
  const body = await res.json();
  const [kind, out] = body.methodResponses?.[0] ?? [];
  if (kind === "error") {
    console.error("[mail] mail server admin API error", JSON.stringify(out));
    throw new UserError("The mail server rejected a mailbox request", 502);
  }
  return out;
}

/**
 * Every user mailbox on the mail server, up to `max`, through the same admin API; for eDiscovery
 * searches that name no custodians. Null when MAIL_ADMIN_URL isn't set.
 */
export async function listMailboxes(max: number): Promise<string[] | null> {
  const url = process.env.MAIL_ADMIN_URL;
  if (!url) return null;
  const ids: string[] = (await call(url, [["x:Account/query", { filter: {}, limit: max }, "q"]]))?.ids ?? [];
  if (!ids.length) return [];
  const accounts: { name?: string; domainId?: string; "@type"?: string }[] =
    (await call(url, [["x:Account/get", { ids: ids.slice(0, max), properties: ["name", "domainId", "@type"] }, "g"]]))?.list ?? [];
  const users = accounts.filter((a) => a.name && (!a["@type"] || a["@type"] === "User"));
  const domainIds = [...new Set(users.map((a) => a.domainId).filter((d): d is string => Boolean(d)))];
  const domains: { id: string; name: string }[] = domainIds.length
    ? (await call(url, [["x:Domain/get", { ids: domainIds, properties: ["id", "name"] }, "d"]]))?.list ?? []
    : [];
  const domainName = new Map(domains.map((d) => [d.id, d.name]));
  const service = (process.env.MAIL_MASTER_USER || "").toLowerCase();
  return users
    .map((a) => (a.name!.includes("@") ? a.name! : a.domainId && domainName.has(a.domainId) ? `${a.name}@${domainName.get(a.domainId)}` : ""))
    .map((e) => e.toLowerCase())
    .filter((e) => e && e !== service); // Mail's own service login holds no one's mail
}
