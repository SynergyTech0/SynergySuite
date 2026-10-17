import nodemailer, { type Transporter } from "nodemailer";
import { ensureMailbox } from "./mailbox";

/**
 * How campaign email leaves. Either:
 *
 *   CAMPAIGNS_SMTP_HOST, CAMPAIGNS_SMTP_USER, CAMPAIGNS_SMTP_PASSWORD [CAMPAIGNS_SMTP_PORT=587]
 *     any SMTP relay (your own server, or a bulk provider such as SES, Postmark or Mailgun),
 *     sending from the From address in Settings, which the relay must allow; or
 *   MAIL_SMTP_HOST, MAIL_MASTER_USER, MAIL_MASTER_PASSWORD (what compose sets for the suite's Stalwart)
 *     the suite mail server sends from the From mailbox, created on Stalwart if need be when
 *     MAIL_ADMIN_URL is set, as Mail does. Bounces then come back to that mailbox.
 *
 * With neither, nothing is sent: campaigns stay queued and say why. Demo mode sends nothing.
 */

export type Outgoing = {
  from: string; fromName: string; replyTo?: string; to: string; subject: string; text: string; html: string;
  /** Extra headers: List-Unsubscribe and friends, the delivery's id for matching bounces. */
  headers: Record<string, string>;
  messageId: string;
};

/** permanent: the receiving server refused this address for good (a 5xx), so don't try it again. */
export type Sent = { sent: true; messageId: string } | { sent: false; reason: string; permanent: boolean };

export type Mode = { kind: "smtp" } | { kind: "suite" } | { kind: "off"; reason: string };

export function mode(env: NodeJS.ProcessEnv = process.env): Mode {
  if (env.DEMO_MODE === "1") return { kind: "off", reason: "Sending is off in demo mode" };
  if (env.CAMPAIGNS_SMTP_HOST && env.CAMPAIGNS_SMTP_USER && env.CAMPAIGNS_SMTP_PASSWORD) return { kind: "smtp" };
  if (env.MAIL_SMTP_HOST && env.MAIL_MASTER_USER && env.MAIL_MASTER_PASSWORD) return { kind: "suite" };
  return { kind: "off", reason: "No mail server is set up (CAMPAIGNS_SMTP_* or the suite mail server)" };
}

/** A line for the Settings page saying where mail goes. */
export function describeMode(m: Mode = mode()): { mode: Mode["kind"]; detail: string } {
  if (m.kind === "smtp") return { mode: "smtp", detail: `SMTP relay ${process.env.CAMPAIGNS_SMTP_HOST}:${Number(process.env.CAMPAIGNS_SMTP_PORT) || 587}` };
  if (m.kind === "suite") return { mode: "suite", detail: "The suite mail server" };
  return { mode: "off", detail: m.reason };
}

const g = globalThis as unknown as { __campaignsSmtp?: Map<string, Transporter> };

function transport(key: string, make: () => Transporter): Transporter {
  g.__campaignsSmtp ??= new Map();
  let t = g.__campaignsSmtp.get(key);
  if (!t) g.__campaignsSmtp.set(key, (t = make()));
  return t;
}

function smtpFor(m: Mode, from: string): Transporter {
  const env = process.env;
  if (m.kind === "smtp") {
    const port = Number(env.CAMPAIGNS_SMTP_PORT) || 587;
    return transport("smtp", () => nodemailer.createTransport({
      host: env.CAMPAIGNS_SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465 && env.CAMPAIGNS_SMTP_TLS !== "off",
      auth: { user: env.CAMPAIGNS_SMTP_USER, pass: env.CAMPAIGNS_SMTP_PASSWORD },
      pool: true, maxConnections: 3,
    }));
  }
  // The suite mail server lets one trusted service login act for any mailbox, as Mail does.
  const port = Number(env.MAIL_SMTP_PORT) || 465;
  const login = (env.MAIL_MASTER_LOGIN || "{user}%{master}").replace("{user}", from).replace("{master}", env.MAIL_MASTER_USER!);
  return transport(`suite:${from}`, () => nodemailer.createTransport({
    host: env.MAIL_SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
    // Stalwart's certificate is self-signed until it is given a real one; this hop stays on the compose network.
    tls: { rejectUnauthorized: env.MAIL_SUITE_TLS_INSECURE !== "true" },
    auth: { user: login, pass: env.MAIL_MASTER_PASSWORD },
    pool: true, maxConnections: 3,
  }));
}

/** A refusal the receiving side means for good: an SMTP 5xx naming the recipient. */
export function isPermanent(e: unknown): boolean {
  const err = e as { responseCode?: number; code?: string; command?: string };
  return typeof err?.responseCode === "number" && err.responseCode >= 500 && err.responseCode < 600 && (err.command === "RCPT TO" || err.code === "EENVELOPE");
}

/** Tests swap `send`; everything else goes through SMTP. */
export const outbox: { send: (m: Outgoing) => Promise<Sent> } = {
  async send(msg) {
    const m = mode();
    if (m.kind === "off") return { sent: false, reason: m.reason, permanent: false };
    try {
      if (m.kind === "suite") await ensureMailbox(msg.from);
      const info = await smtpFor(m, msg.from).sendMail({
        from: { name: msg.fromName, address: msg.from },
        ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        messageId: msg.messageId,
        headers: msg.headers,
      });
      return { sent: true, messageId: info.messageId || msg.messageId };
    } catch (e) {
      return { sent: false, reason: (e as Error).message.slice(0, 500), permanent: isPermanent(e) };
    }
  },
};
