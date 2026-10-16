import { route } from "@/lib/api";
import { UserError, addAccount, listAccounts, vetEndpoint, type Account } from "@/lib/accounts";
import { withImap } from "@/lib/mailbox";
import { demoMode } from "@/lib/demo";

export const dynamic = "force-dynamic";

export const GET = route(async ({ user }) => ({ accounts: await listAccounts(user), canAddAccounts: !demoMode() }));

/** Connect an outside mailbox. We sign in once before saving so typos fail here, not later. */
export const POST = route(async ({ user }, req) => {
  if (demoMode()) throw new UserError("This is a demo: outside accounts can't be added", 403);
  const b = await req.json().catch(() => ({}));
  const str = (k: string) => (typeof b[k] === "string" ? b[k].trim() : "");
  const address = str("address").toLowerCase();
  const password = typeof b.password === "string" ? b.password : "";
  const imapHost = str("imapHost");
  const smtpHost = str("smtpHost") || imapHost.replace(/^imap\./, "smtp.");
  if (!/^[^@\s]+@[^@\s]+$/.test(address)) throw new UserError("Enter a valid email address");
  if (!password) throw new UserError("Enter the account's password or app password");
  if (!imapHost) throw new UserError("Enter the IMAP server");
  const fields = {
    label: str("label") || address,
    address,
    username: str("username") || address,
    password,
    imapHost, imapPort: Number(b.imapPort) || 993, imapSecure: b.imapSecure !== false,
    smtpHost, smtpPort: Number(b.smtpPort) || 465, smtpSecure: b.smtpSecure !== false,
  };
  const probe: Account = {
    id: "new", owner: user, label: fields.label, address, fromName: "",
    imap: await vetEndpoint({ host: imapHost, port: fields.imapPort, secure: fields.imapSecure }),
    smtp: await vetEndpoint({ host: smtpHost, port: fields.smtpPort, secure: fields.smtpSecure }),
    auth: { user: fields.username, pass: password },
  };
  await withImap(probe, async () => undefined);
  return { id: await addAccount(user, fields) };
});
