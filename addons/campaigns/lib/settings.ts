import { q } from "./db";
import { describeMode } from "./mailer";
import { assertAdmin } from "./members";
import type { Ctx, Settings } from "./types";
import { UserError, isEmail, optionalEmail, text } from "./util";

type Row = { from_name: string; from_email: string; reply_to: string; org_name: string; postal_address: string; per_minute: number };

/** The suite's own address for campaigns until an admin picks one: marketing@ the mail domain. */
function defaultFrom(): string {
  const env = process.env;
  if (env.CAMPAIGNS_FROM_EMAIL) return env.CAMPAIGNS_FROM_EMAIL.toLowerCase();
  const domain = env.MAIL_DOMAIN || env.SUITE_DOMAIN;
  return domain ? `marketing@${domain}` : "";
}

/** Who campaigns come from. Blank settings fall back to CAMPAIGNS_FROM_* and the organization's name. */
export async function getSettings(): Promise<Settings> {
  const [r] = await q<Row>("SELECT * FROM settings WHERE id = 1");
  const env = process.env;
  return {
    fromName: r?.from_name || env.CAMPAIGNS_FROM_NAME || env.CAMPAIGNS_ORG_NAME || "",
    fromEmail: r?.from_email || defaultFrom(),
    replyTo: r?.reply_to || "",
    orgName: r?.org_name || env.CAMPAIGNS_ORG_NAME || "",
    postalAddress: r?.postal_address || env.CAMPAIGNS_POSTAL_ADDRESS || "",
    perMinute: r?.per_minute || Number(env.CAMPAIGNS_PER_MINUTE) || 60,
    sender: describeMode(),
  };
}

export async function saveSettings(ctx: Ctx, b: Record<string, unknown>): Promise<Settings> {
  assertAdmin(ctx);
  const fromEmail = optionalEmail(b.fromEmail, "email address for From");
  const perMinute = Number(b.perMinute ?? 60);
  if (!Number.isInteger(perMinute) || perMinute < 1 || perMinute > 6000) throw new UserError("Sending speed must be 1 to 6000 emails a minute");
  await q(
    `INSERT INTO settings (id, from_name, from_email, reply_to, org_name, postal_address, per_minute, updated_at, updated_by)
     VALUES (1, $1, $2, $3, $4, $5, $6, now(), $7)
     ON CONFLICT (id) DO UPDATE SET from_name = $1, from_email = $2, reply_to = $3, org_name = $4, postal_address = $5,
       per_minute = $6, updated_at = now(), updated_by = $7`,
    [text(b.fromName, 120), fromEmail, optionalEmail(b.replyTo, "email address for Reply-To"), text(b.orgName, 200), text(b.postalAddress, 400), perMinute, ctx.email],
  );
  return getSettings();
}

/**
 * What stops a send before it starts. Anti-spam law (CAN-SPAM, CASL, GDPR/PECR) wants a real
 * sender, a postal address and a working unsubscribe in every marketing email; the unsubscribe
 * is always added, the other two must be filled in.
 */
export function sendBlockers(s: Settings): string[] {
  const out: string[] = [];
  if (!isEmail(s.fromEmail)) out.push("Set the From address in Settings");
  if (!s.orgName) out.push("Set your organization's name in Settings");
  if (!s.postalAddress) out.push("Set your postal address in Settings (the law asks every marketing email to carry one)");
  if (s.sender.mode === "off") out.push(s.sender.detail);
  return out;
}
