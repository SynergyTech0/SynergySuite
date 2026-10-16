import nodemailer, { type Transporter } from "nodemailer";
import { normalizeMessageId } from "./threading";

/**
 * Email in and out. Both directions are off until their settings are present, so Desk can be
 * deployed before a support mailbox exists:
 *
 *   Inbound (IMAP poll):  DESK_IMAP_HOST, DESK_IMAP_USER, DESK_IMAP_PASSWORD
 *                         [DESK_IMAP_PORT=993, DESK_IMAP_FOLDER=INBOX, DESK_IMAP_POLL_SECONDS=120]
 *   Outbound (SMTP):      DESK_SMTP_HOST, DESK_SMTP_USER, DESK_SMTP_PASSWORD, DESK_SMTP_FROM
 *                         [DESK_SMTP_PORT=587]
 *
 * Without SMTP, staff replies are still saved on the ticket, marked as not emailed.
 */

export type ImapConfig = { host: string; port: number; secure: boolean; user: string; pass: string; folder: string; everyMs: number };

export function imapConfig(env: NodeJS.ProcessEnv = process.env): ImapConfig | null {
  if (!env.DESK_IMAP_HOST || !env.DESK_IMAP_USER || !env.DESK_IMAP_PASSWORD) return null;
  const port = Number(env.DESK_IMAP_PORT) || 993;
  return {
    host: env.DESK_IMAP_HOST,
    port,
    secure: port === 993,
    user: env.DESK_IMAP_USER,
    pass: env.DESK_IMAP_PASSWORD,
    folder: env.DESK_IMAP_FOLDER || "INBOX",
    everyMs: Math.max(15, Number(env.DESK_IMAP_POLL_SECONDS) || 120) * 1000,
  };
}

function smtpArmed(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DESK_SMTP_HOST && env.DESK_SMTP_USER && env.DESK_SMTP_PASSWORD && env.DESK_SMTP_FROM);
}

export function mailState() {
  return { inbound: imapConfig() !== null, outbound: smtpArmed() };
}

const g = globalThis as unknown as { __deskSmtp?: Transporter };

function transport(): Transporter {
  if (!g.__deskSmtp) {
    const port = Number(process.env.DESK_SMTP_PORT) || 587;
    g.__deskSmtp = nodemailer.createTransport({
      host: process.env.DESK_SMTP_HOST,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user: process.env.DESK_SMTP_USER, pass: process.env.DESK_SMTP_PASSWORD },
    });
  }
  return g.__deskSmtp;
}

export type Outgoing = { to: string; subject: string; body: string; inReplyTo?: string | null; references?: string[] };
export type SendResult = { emailed: boolean; messageId: string | null; reason?: string };

/** Tests swap this out; everything else goes through SMTP. */
export const outbox: { send: (m: Outgoing) => Promise<SendResult> } = {
  async send(m) {
    if (!smtpArmed()) return { emailed: false, messageId: null, reason: "email sending isn't set up" };
    const refs = (m.references ?? []).filter(Boolean);
    const info = await transport().sendMail({
      from: process.env.DESK_SMTP_FROM,
      to: m.to,
      subject: m.subject,
      text: m.body,
      ...(m.inReplyTo ? { inReplyTo: m.inReplyTo } : {}),
      ...(refs.length ? { references: refs.join(" ") } : {}),
    });
    return { emailed: true, messageId: normalizeMessageId(info.messageId) };
  },
};
