import { resolveMx } from "node:dns/promises";

/**
 * Who hosts an address's mail, from its MX records, so Add account can offer the right sign-in
 * for company domains a preset can't know about (GoDaddy sells both kinds below under a
 * customer's own domain).
 *   microsoft: Microsoft 365 (including GoDaddy's "Microsoft 365 from GoDaddy") or Outlook.com.
 *              Password sign-in is off there, so it needs Sign in with Microsoft.
 *   godaddy:   GoDaddy Workspace Email, which still takes a password over IMAP and SMTP.
 */
export type Provider =
  | { kind: "microsoft" }
  | { kind: "imap"; name: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number };

const MICROSOFT_DOMAINS = new Set(["outlook.com", "hotmail.com", "live.com", "msn.com", "outlook.co.uk", "hotmail.co.uk", "live.co.uk"]);

export const GODADDY_WORKSPACE: Provider = {
  kind: "imap", name: "GoDaddy Workspace Email",
  imapHost: "imap.secureserver.net", imapPort: 993, smtpHost: "smtpout.secureserver.net", smtpPort: 465,
};

export function fromMx(exchanges: string[]): Provider | null {
  const mx = exchanges.map((e) => e.toLowerCase().replace(/\.$/, ""));
  if (mx.some((e) => e.endsWith(".mail.protection.outlook.com") || e.endsWith(".olc.protection.outlook.com"))) return { kind: "microsoft" };
  if (mx.some((e) => e.endsWith(".secureserver.net"))) return GODADDY_WORKSPACE;
  return null;
}

export async function detectProvider(address: string, lookup: (d: string) => Promise<{ exchange: string }[]> = resolveMx): Promise<Provider | null> {
  const domain = address.split("@")[1]?.toLowerCase().trim();
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  if (MICROSOFT_DOMAINS.has(domain)) return { kind: "microsoft" };
  const records = await lookup(domain).catch(() => []);
  return fromMx(records.map((r) => r.exchange));
}
