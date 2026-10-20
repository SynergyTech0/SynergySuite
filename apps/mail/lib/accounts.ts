import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { q } from "./db";
import { open, seal } from "./secret";
import { isSharedMailboxMember, sharedMailboxesOf } from "./memberships";
import { graphMailboxesOf } from "./graph";
import { MICROSOFT_IMAP, MICROSOFT_SMTP, OAuthError, accessToken, forgetToken, type SignedIn } from "./oauth";

/**
 * secure: TLS from the first byte (993/465). Otherwise the connection is upgraded with STARTTLS,
 * which is required for outside accounts so passwords never cross the internet in the clear.
 */
export type Endpoint = {
  host: string; port: number; secure: boolean;
  servername?: string; insecureTls?: boolean; allowPlain?: boolean;
};
export type Auth = { user: string; pass: string } | { user: string; accessToken: string };

/** Everything needed to talk to one mailbox. Never sent to the browser. */
export type Account = {
  id: string; // "suite" for the suite-hosted mailbox, "shared:<address>" for a shared one, otherwise the accounts row id
  owner: string; // the suite user it belongs to
  label: string;
  address: string;
  fromName: string; // display name on outgoing mail

  imap: Endpoint;
  smtp: Endpoint;
  auth: Auth;
  /** Shared mailboxes: the folder tree, inside the member's own login, that is this account. */
  folderRoot?: string;
  /** A Microsoft 365 mailbox opened through Microsoft Graph (graph.ts) instead of IMAP/SMTP. */
  graph?: { mailbox: string };
};

/** What the browser is allowed to see about an account. */
export type AccountSummary = { id: string; label: string; address: string; kind: "suite" | "shared" | "imap" | "graph" };

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === "" ? d : v === "true" || v === "1");

/**
 * The suite mailbox lives on the suite's own mail server (Stalwart in deploy/compose.yml) and is
 * opened for the signed-in user without asking for a mail password: see suiteAuth().
 * Unset MAIL_IMAP_HOST to run Mail with outside accounts only.
 */
function suiteAccount(email: string, name = ""): Account | null {
  const host = process.env.MAIL_IMAP_HOST;
  const auth = suiteAuth(email);
  if (!host || !auth) return null;
  const insecureTls = bool(process.env.MAIL_SUITE_TLS_INSECURE, false);
  return {
    id: "suite",
    owner: email,
    label: process.env.MAIL_SUITE_LABEL || "Mailbox",
    address: email,
    fromName: name,
    imap: { host, port: Number(process.env.MAIL_IMAP_PORT || 993), secure: bool(process.env.MAIL_IMAP_SECURE, true), insecureTls },
    smtp: {
      host: process.env.MAIL_SMTP_HOST || host,
      port: Number(process.env.MAIL_SMTP_PORT || 465),
      secure: bool(process.env.MAIL_SMTP_SECURE, true),
      insecureTls,
    },
    auth,
  };
}

/**
 * A shared mailbox (a Stalwart group account) the person is a member of. Stalwart shows a
 * group's folders to each member under "Shared Folders/<address>/" in their own login and lets
 * them send from its address, so this is the person's own suite login scoped to that folder
 * tree (see mailbox.ts), sending as the group. Only for current members (Groups decides).
 */
function sharedAccount(email: string, name: string, shared: { address: string; name: string }): Account | null {
  const suite = suiteAccount(email, name);
  if (!suite) return null;
  return {
    ...suite,
    id: `shared:${shared.address}`,
    label: shared.name,
    address: shared.address,
    fromName: shared.name === shared.address ? "" : shared.name,
    folderRoot: `${process.env.MAIL_SHARED_FOLDERS || "Shared Folders"}/${shared.address}`,
  };
}

/**
 * A company Microsoft 365 mailbox the admin gave this person (graph.ts decides which). Opened with
 * the organization's app through Microsoft Graph, so imap/smtp/auth are placeholders never used.
 */
function graphAccount(owner: string, name: string, mailbox: string): Account {
  const none = { host: "graph.microsoft.com", port: 443, secure: true };
  return {
    id: `graph:${mailbox}`, owner, label: mailbox, address: mailbox,
    fromName: mailbox === owner.toLowerCase() ? name : "",
    imap: none, smtp: none, auth: { user: mailbox, pass: "" }, graph: { mailbox },
  };
}

/** True for accounts on the suite's own mail server (the person's mailbox and shared ones). */
export const onSuiteServer = (acct: Pick<Account, "id">) => acct.id === "suite" || acct.id.startsWith("shared:");

/**
 * How Mail logs in to the suite mail server on a user's behalf.
 *   master: one trusted service login that may open any mailbox (MAIL_MASTER_USER / _PASSWORD,
 *           MAIL_MASTER_LOGIN shapes the login, with {user} and {master} filled in).
 *   shared-password: every mailbox has the same password. Development only.
 */
function suiteAuth(email: string): Auth | null {
  const mode = process.env.MAIL_SUITE_AUTH || "master";
  if (mode === "master") {
    const master = process.env.MAIL_MASTER_USER;
    const pass = process.env.MAIL_MASTER_PASSWORD;
    if (!master || !pass) return null;
    const login = (process.env.MAIL_MASTER_LOGIN || "{user}%{master}").replace("{user}", email).replace("{master}", master);
    return { user: login, pass };
  }
  if (mode === "shared-password" && process.env.NODE_ENV !== "production") {
    const pass = process.env.MAIL_DEV_PASSWORD;
    return pass ? { user: email, pass } : null;
  }
  return null;
}

type Row = {
  id: string; owner_email: string; label: string; address: string;
  imap_host: string; imap_port: number; imap_secure: boolean;
  smtp_host: string; smtp_port: number; smtp_secure: boolean;
  username: string; secret: string;
  auth_kind: "password" | "microsoft";
};

async function fromRow(r: Row): Promise<Account> {
  return {
    id: String(r.id),
    owner: r.owner_email,
    label: r.label,
    address: r.address,
    fromName: r.label === r.address ? "" : r.label,
    imap: { host: r.imap_host, port: r.imap_port, secure: r.imap_secure },
    smtp: { host: r.smtp_host, port: r.smtp_port, secure: r.smtp_secure },
    auth: r.auth_kind === "microsoft"
      ? { user: r.username, accessToken: await microsoftToken(r) }
      : { user: r.username, pass: open(r.secret) },
  };
}

/** A fresh access token for a Microsoft account; a sign-in Microsoft no longer honours fails like a wrong password. */
async function microsoftToken(r: Row): Promise<string> {
  try {
    return await accessToken(String(r.id), r.secret, async (sealed) => {
      await q("UPDATE accounts SET secret = $1 WHERE id = $2", [sealed, r.id]);
    });
  } catch (err) {
    if (!(err instanceof OAuthError)) throw err;
    const why = err.expired ? "the Microsoft sign-in has expired; use Add account to sign in with Microsoft again" : err.message;
    throw Object.assign(new UserError(`Couldn't sign in to ${r.address}: ${why}`, 502), { authFailed: err.expired });
  }
}

export async function listAccounts(owner: string): Promise<AccountSummary[]> {
  const out: AccountSummary[] = [];
  const suite = suiteAccount(owner);
  if (suite) {
    out.push({ id: suite.id, label: suite.label, address: suite.address, kind: "suite" });
    for (const m of await sharedMailboxesOf(owner)) out.push({ id: `shared:${m.address}`, label: m.name, address: m.address, kind: "shared" });
  }
  for (const m of graphMailboxesOf(owner)) out.push({ id: `graph:${m}`, label: m, address: m, kind: "graph" });
  const rows = await q<Row>("SELECT * FROM accounts WHERE owner_email = $1 ORDER BY id", [owner]);
  for (const r of rows) out.push({ id: String(r.id), label: r.label, address: r.address, kind: "imap" });
  return out;
}

/** The account if it belongs to this user, else null. */
export async function getAccount(owner: string, id: string, ownerName = ""): Promise<Account | null> {
  if (id === "suite") return suiteAccount(owner, ownerName);
  if (id.startsWith("shared:")) {
    const shared = await isSharedMailboxMember(owner, id.slice("shared:".length));
    return shared ? sharedAccount(owner, ownerName, shared) : null;
  }
  if (id.startsWith("graph:")) {
    const mailbox = id.slice("graph:".length);
    return graphMailboxesOf(owner).includes(mailbox) ? graphAccount(owner, ownerName, mailbox) : null;
  }
  if (!/^\d+$/.test(id)) return null;
  const rows = await q<Row>("SELECT * FROM accounts WHERE id = $1 AND owner_email = $2", [id, owner]);
  return rows[0] ? await fromRow(rows[0]) : null;
}

/**
 * Every outside account a user connected, for the hold sweep. One whose password can't be
 * decrypted (MAIL_ENCRYPTION_KEY changed) is left out and logged.
 */
export async function listOutsideAccounts(owner: string): Promise<Account[]> {
  const out: Account[] = [];
  for (const r of await q<Row>("SELECT * FROM accounts WHERE owner_email = $1 ORDER BY id", [owner])) {
    try {
      out.push(await fromRow(r));
    } catch (err) {
      console.error(`[mail] can't open the saved sign-in of ${r.address}:`, (err as Error).message);
    }
  }
  return out;
}

export type NewAccount = {
  label?: string; address: string; username?: string; password: string;
  imapHost: string; imapPort?: number; imapSecure?: boolean;
  smtpHost: string; smtpPort?: number; smtpSecure?: boolean;
};

export async function addAccount(owner: string, a: NewAccount): Promise<string> {
  const rows = await q<{ id: string }>(
    `INSERT INTO accounts (owner_email, label, address, imap_host, imap_port, imap_secure,
                           smtp_host, smtp_port, smtp_secure, username, secret)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [owner, a.label || a.address, a.address, a.imapHost, a.imapPort ?? 993, a.imapSecure ?? true,
     a.smtpHost, a.smtpPort ?? 465, a.smtpSecure ?? true, a.username || a.address, seal(a.password)],
  );
  return String(rows[0].id);
}

/**
 * Saves a Microsoft 365 / Outlook.com account after Sign in with Microsoft. Signing in again to
 * an address already connected renews its sign-in instead of adding it twice.
 */
export async function saveMicrosoftAccount(owner: string, s: SignedIn): Promise<string> {
  const label = s.name || s.address;
  const [found] = await q<{ id: string }>(
    "SELECT id FROM accounts WHERE owner_email = $1 AND lower(address) = $2 AND auth_kind = 'microsoft' ORDER BY id LIMIT 1",
    [owner, s.address],
  );
  if (found) {
    await q("UPDATE accounts SET secret = $1, username = $2 WHERE id = $3", [seal(s.refreshToken), s.address, found.id]);
    forgetToken(String(found.id));
    return String(found.id);
  }
  const rows = await q<{ id: string }>(
    `INSERT INTO accounts (owner_email, label, address, imap_host, imap_port, imap_secure,
                           smtp_host, smtp_port, smtp_secure, username, secret, auth_kind)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'microsoft') RETURNING id`,
    [owner, label, s.address, MICROSOFT_IMAP.host, MICROSOFT_IMAP.port, MICROSOFT_IMAP.secure,
     MICROSOFT_SMTP.host, MICROSOFT_SMTP.port, MICROSOFT_SMTP.secure, s.address, seal(s.refreshToken)],
  );
  return String(rows[0].id);
}

/** Removes an outside account. Mail preserved from it for a legal hold stays, marked as removed. */
export async function removeAccount(owner: string, id: string): Promise<boolean> {
  if (!/^\d+$/.test(id)) return false;
  if (!(await q("DELETE FROM accounts WHERE id = $1 AND owner_email = $2 RETURNING id", [id, owner])).length) return false;
  forgetToken(id);
  await q("UPDATE preserve_accounts SET removed_at = now() WHERE mailbox = $1 AND account = $2", [owner, id]);
  return true;
}

const MAIL_PORTS = new Set([25, 143, 465, 587, 993, 2525]);

/**
 * Outside accounts make this server connect wherever a user points it, so only standard mail
 * ports on public addresses are allowed (otherwise Mail could be used to probe the internal
 * network). Returns the endpoint pinned to the address that was checked, so a DNS answer that
 * changes between the check and the connection can't redirect it.
 */
export async function vetEndpoint(e: Endpoint): Promise<Endpoint> {
  // For local development against a test mail server only.
  if (process.env.MAIL_ALLOW_PRIVATE_HOSTS === "1" && process.env.NODE_ENV !== "production") return { ...e, allowPlain: true, insecureTls: true };
  if (!MAIL_PORTS.has(e.port)) throw new UserError(`Port ${e.port} is not a mail port`);
  const { address } = isIP(e.host) ? { address: e.host } : await lookup(e.host).catch(() => {
    throw new UserError(`Can't find the server ${e.host}`);
  });
  if (isPrivate(address)) throw new UserError(`${e.host} is not a public mail server`);
  // An endpoint vetted before (host already the pinned address) keeps the name its certificate is checked against.
  return { ...e, host: address, servername: isIP(e.host) ? e.servername : e.host };
}

export function isPrivate(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** An error whose message is safe and useful to show the user. */
export class UserError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
