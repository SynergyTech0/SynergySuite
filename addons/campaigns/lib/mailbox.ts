import { randomBytes } from "node:crypto";

/**
 * Makes sure the suite mailbox campaigns send from exists on Stalwart, as Mail does the first time
 * someone opens it (MAIL_ADMIN_URL with MAIL_ADMIN_USER / MAIL_ADMIN_PASSWORD). Without those
 * settings the mailbox must already exist. The password is random and never shown: sending
 * uses the suite's master login.
 */
const known = new Set<string>();

export async function ensureMailbox(email: string): Promise<void> {
  const url = process.env.MAIL_ADMIN_URL;
  if (!url || known.has(email)) return;
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const domainId = await first(url, "x:Domain/query", { filter: { name: email.slice(at + 1) } });
  if (!domainId) throw new Error(`the suite mail server doesn't host ${email}`);
  if (!(await first(url, "x:Account/query", { filter: { name: local, domainId } }))) {
    await call(url, [["x:Account/set", {
      create: { u: { "@type": "User", name: local, domainId, description: email, credentials: { "0": { "@type": "Password", secret: randomBytes(24).toString("base64url") } } } },
    }, "c"]]);
    // Created now, or by someone else at the same moment.
    if (!(await first(url, "x:Account/query", { filter: { name: local, domainId } }))) throw new Error(`couldn't create the mailbox ${email}`);
  }
  known.add(email);
}

async function first(url: string, method: string, args: object): Promise<string | undefined> {
  return (await call(url, [[method, args, "q"]]))?.ids?.[0];
}

async function call(url: string, methodCalls: unknown[]) {
  const auth = Buffer.from(`${process.env.MAIL_ADMIN_USER || "admin"}:${process.env.MAIL_ADMIN_PASSWORD || ""}`).toString("base64");
  const res = await fetch(`${url.replace(/\/$/, "")}/jmap/`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: JSON.stringify({ using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"], methodCalls }),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`mail server admin API answered ${res.status}`);
  const [kind, out] = (await res.json()).methodResponses?.[0] ?? [];
  if (kind === "error") throw new Error(`mail server admin API: ${JSON.stringify(out)}`);
  return out;
}
