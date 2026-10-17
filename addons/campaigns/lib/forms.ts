/**
 * The public signup form for an audience (/f/<audience id>), for a website link or embed. With
 * double opt-in (the default) a new address is "pending" until its owner clicks the link in a
 * confirmation email, which proves the address is theirs and records their consent. A person who
 * once unsubscribed can come back this way; nobody else can resubscribe them.
 */
import { upsertMany } from "./audiences";
import { queueAutomations } from "./automations";
import { q, tx } from "./db";
import { outbox } from "./mailer";
import { publicBase } from "./render";
import { getSettings } from "./settings";
import { UserError, escapeHtml, isEmail, isUuid, text, token } from "./util";

export type PublicForm = { id: string; name: string; intro: string; doubleOptIn: boolean; orgName: string };

export async function publicForm(id: string): Promise<PublicForm | null> {
  if (!isUuid(id)) return null;
  const [a] = await q<{ id: string; name: string; form_intro: string; double_opt_in: boolean; form_enabled: boolean }>(
    "SELECT id, name, form_intro, double_opt_in, form_enabled FROM audiences WHERE id = $1",
    [id],
  );
  if (!a?.form_enabled) return null;
  return { id: a.id, name: a.name, intro: a.form_intro, doubleOptIn: a.double_opt_in, orgName: (await getSettings()).orgName };
}

// A few signups a minute from one address is plenty for a person and too slow for a bot.
const hits = new Map<string, number[]>();
export function rateLimited(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear();
  return recent.length > 5;
}

export type SignupResult = "confirm-sent" | "subscribed";

export async function signup(form: PublicForm, b: Record<string, string>, ip: string): Promise<SignupResult> {
  const email = text(b.email, 254).toLowerCase();
  if (!isEmail(email)) throw new UserError("Enter a valid email address");
  const person = { email, firstName: text(b.first_name, 100), lastName: text(b.last_name, 100), source: "form", resubscribe: true, consentIp: ip };
  if (!form.doubleOptIn) {
    await tx(async (tq) => {
      await upsertMany(null, form.id, [{ ...person, status: "subscribed" }], tq);
      await tq("DELETE FROM suppressions WHERE email = $1 AND reason IN ('unsubscribed','complained')", [email]);
    });
    return "subscribed";
  }
  const [already] = await q("SELECT 1 FROM subscribers WHERE audience_id = $1 AND lower(email) = $2 AND status = 'subscribed'", [form.id, email]);
  if (already) return "subscribed";
  const confirm = token();
  await upsertMany(null, form.id, [{ ...person, status: "pending", confirmToken: confirm }]);
  const s = await getSettings();
  const link = `${publicBase()}/f/confirm/${confirm}`;
  const who = escapeHtml(s.orgName || form.name);
  const res = await outbox.send({
    from: s.fromEmail, fromName: s.fromName || s.orgName, replyTo: s.replyTo || undefined, to: email,
    subject: `Please confirm your subscription to ${form.name}`,
    text: `Please confirm you want to hear from ${s.orgName || form.name} (${form.name}):\n\n${link}\n\nIf you didn't ask for this, ignore this email and you won't hear from us.\n\n${s.orgName}\n${s.postalAddress}`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:24px auto;color:#1f2328">
<p>Please confirm you want to hear from ${who} (${escapeHtml(form.name)}).</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#0f6cbd;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Yes, subscribe me</a></p>
<p style="color:#6b7280;font-size:13px">If you didn't ask for this, ignore this email and you won't hear from us.<br>${escapeHtml(s.orgName)}, ${escapeHtml(s.postalAddress)}</p></div>`,
    headers: { "Auto-Submitted": "auto-generated" },
    messageId: `<confirm-${confirm}@${s.fromEmail.split("@")[1] || "localhost"}>`,
  });
  if (!res.sent) throw new UserError("We couldn't send the confirmation email just now. Please try again later.", 503);
  return "confirm-sent";
}

/** The pending signup a confirmation link names, if any. */
export async function pendingByToken(tok: string): Promise<{ id: string; email: string; audienceName: string } | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(tok)) return null;
  const [r] = await q<{ id: string; email: string; name: string }>(
    "SELECT s.id, s.email, a.name FROM subscribers s JOIN audiences a ON a.id = s.audience_id WHERE s.confirm_token = $1",
    [tok],
  );
  return r ? { id: r.id, email: r.email, audienceName: r.name } : null;
}

export async function confirm(tok: string): Promise<{ email: string; audienceName: string } | null> {
  const p = await pendingByToken(tok);
  if (!p) return null;
  await tx(async (tq) => {
    const [row] = await tq<{ audience_id: string; status: string }>(
      `UPDATE subscribers SET status = 'subscribed', confirm_token = NULL, consent_at = now(), unsubscribed_at = NULL, updated_at = now()
       WHERE id = $1 RETURNING audience_id, status`,
      [p.id],
    );
    // Confirming proves the address works and that they want mail; a block added by hand stays.
    await tq("DELETE FROM suppressions WHERE email = lower($1) AND reason <> 'manual'", [p.email]);
    await queueAutomations(tq, row.audience_id, [p.id], []);
  });
  return { email: p.email, audienceName: p.audienceName };
}
