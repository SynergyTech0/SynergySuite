// @mentions in comments notify the people named, by e-mail, when the suite
// has a mail server configured (SMTP_HOST, as SynergyAuth uses; SMTP_PORT,
// SMTP_SECURE, SMTP_USER/SMTP_PASSWORD, MAIL_FROM). Only people who can open
// the document are told: its owner, people it is shared with, and for a
// company-wide document people at the mentioner's own e-mail domain.
import { q } from "@/lib/db";
import type { Identity } from "@/lib/identity";
import type { DocRow } from "@/lib/access";
import { mentionsIn } from "@/lib/slides/comments";

const PATH: Record<string, string> = { doc: "doc", sheet: "sheet", slide: "slides" };

export type MailSender = (to: string, subject: string, text: string) => Promise<void>;

/** The mail server from the environment, or null when there is none. */
export async function smtpSender(env: Record<string, string | undefined> = process.env): Promise<MailSender | null> {
  const host = env.SMTP_HOST;
  if (!host) return null;
  const port = Number(env.SMTP_PORT) || 25;
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: env.SMTP_SECURE === "true" || port === 465,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD || "" } } : {}),
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });
  const from = env.MAIL_FROM || `Synergy Office <no-reply@${env.SUITE_DOMAIN || "localhost"}>`;
  return async (to, subject, text) => {
    await transport.sendMail({ from, to, subject, text });
  };
}

/** Of `emails`, the people the document is shared with (lower case). */
export type Granted = (doc: Pick<DocRow, "id" | "org">, emails: string[]) => Promise<Set<string>>;
const dbGrants: Granted = async (doc, emails) =>
  new Set((await q<{ email: string }>(`SELECT lower(email) AS email FROM doc_grants WHERE doc_id = $1 AND org = $2 AND lower(email) = ANY($3)`, [doc.id, doc.org, emails])).map((r) => r.email));

/** Who of `emails` may open the document (and so may be told about it). */
export async function mayOpen(doc: Pick<DocRow, "id" | "org" | "owner_email" | "scope" | "company_role">, by: Identity, emails: string[], granted: Granted = dbGrants): Promise<string[]> {
  if (!emails.length) return [];
  const grants = await granted(doc, emails);
  const domain = by.email.split("@")[1]?.toLowerCase();
  return emails.filter((e) => e === doc.owner_email.toLowerCase() || grants.has(e) || (doc.scope === "company" && !!doc.company_role && !!domain && e.endsWith(`@${domain}`)));
}

/**
 * Tell the people a new comment mentions (not its author, not people the
 * thread already mentioned). Returns who was told; never throws, so a mail
 * problem never loses a comment.
 */
export async function notifyMentions(opts: {
  doc: Pick<DocRow, "id" | "org" | "owner_email" | "scope" | "company_role" | "kind" | "title">;
  by: Identity;
  body: string;
  quote?: string;
  /** earlier messages of the thread */
  before?: string[];
  origin: string;
  send?: MailSender | null;
  granted?: Granted;
}): Promise<string[]> {
  try {
    const old = new Set((opts.before || []).flatMap(mentionsIn));
    const named = mentionsIn(opts.body).filter((e) => e !== opts.by.email.toLowerCase() && !old.has(e));
    if (!named.length) return [];
    const send = opts.send === undefined ? await smtpSender() : opts.send;
    if (!send) return [];
    const to = await mayOpen(opts.doc, opts.by, named, opts.granted);
    const link = `${opts.origin.replace(/\/$/, "")}/${PATH[opts.doc.kind] || "doc"}/${encodeURIComponent(opts.doc.id)}`;
    const title = opts.doc.title || "Untitled";
    const text =
      `${opts.by.name || opts.by.email} mentioned you in a comment on "${title}":\n\n` +
      (opts.quote ? `> ${opts.quote.replace(/\n/g, "\n> ")}\n\n` : "") +
      `${opts.body}\n\nOpen it: ${link}\n`;
    const told: string[] = [];
    for (const e of to) {
      try {
        await send(e, `${opts.by.name || opts.by.email} mentioned you in "${title}"`, text);
        told.push(e);
      } catch {
        /* the next one may still go */
      }
    }
    return told;
  } catch {
    return [];
  }
}

/** The address people open documents at: the suite's office host, else this request's origin. */
export function publicOrigin(reqUrl: string, env: Record<string, string | undefined> = process.env): string {
  if (env.SUITE_DOMAIN) return `https://office.${env.SUITE_DOMAIN}`;
  try {
    return new URL(reqUrl).origin;
  } catch {
    return "";
  }
}
