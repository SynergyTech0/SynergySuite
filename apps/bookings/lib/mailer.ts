import nodemailer, { type Transporter } from "nodemailer";
import { ensureMailbox } from "./mailbox";

/**
 * How Bookings sends confirmations and reminders. Either:
 *
 *   BOOKINGS_SMTP_HOST, BOOKINGS_SMTP_USER, BOOKINGS_SMTP_PASSWORD [BOOKINGS_SMTP_PORT=587, BOOKINGS_SMTP_FROM]
 *     one mailbox (any provider) sends everything, with the page's sender as Reply-To; or
 *   MAIL_SMTP_HOST, MAIL_MASTER_USER, MAIL_MASTER_PASSWORD (what compose sets for the suite's Stalwart)
 *     each page sends from its own suite mailbox: its sender address, or the person who made it
 *     (created on Stalwart if need be, when MAIL_ADMIN_URL is set, as Mail does).
 *
 * With neither, appointments are still booked and nothing is emailed. Demo mode emails nobody.
 */

export type Outgoing = {
  /** The suite mailbox to send from, and the name to show. */
  from: string; fromName: string; to: string; subject: string; text: string; html: string;
  ics?: { method: "REQUEST" | "CANCEL"; content: string };
};
export type Sent = { sent: boolean; reason?: string };

type Mode = { kind: "smtp" } | { kind: "suite" } | { kind: "off"; reason: string };

export function mode(env: NodeJS.ProcessEnv = process.env): Mode {
  if (env.DEMO_MODE === "1") return { kind: "off", reason: "demo-mode" };
  if (env.BOOKINGS_SMTP_HOST && env.BOOKINGS_SMTP_USER && env.BOOKINGS_SMTP_PASSWORD) return { kind: "smtp" };
  if (env.MAIL_SMTP_HOST && env.MAIL_MASTER_USER && env.MAIL_MASTER_PASSWORD) return { kind: "suite" };
  return { kind: "off", reason: "not-configured" };
}

const g = globalThis as unknown as { __bookingsSmtp?: Map<string, Transporter> };

function transport(key: string, make: () => Transporter): Transporter {
  g.__bookingsSmtp ??= new Map();
  let t = g.__bookingsSmtp.get(key);
  if (!t) g.__bookingsSmtp.set(key, (t = make()));
  return t;
}

function smtpFor(m: Mode, from: string): { t: Transporter; envelopeFrom: string } {
  const env = process.env;
  if (m.kind === "smtp") {
    const port = Number(env.BOOKINGS_SMTP_PORT) || 587;
    const t = transport("smtp", () => nodemailer.createTransport({
      host: env.BOOKINGS_SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
      auth: { user: env.BOOKINGS_SMTP_USER, pass: env.BOOKINGS_SMTP_PASSWORD },
    }));
    return { t, envelopeFrom: env.BOOKINGS_SMTP_FROM || env.BOOKINGS_SMTP_USER! };
  }
  // The suite mail server lets one trusted service login act for any mailbox, as Mail does.
  const port = Number(env.MAIL_SMTP_PORT) || 465;
  const login = (env.MAIL_MASTER_LOGIN || "{user}%{master}").replace("{user}", from).replace("{master}", env.MAIL_MASTER_USER!);
  const t = transport(`suite:${from}`, () => nodemailer.createTransport({
    host: env.MAIL_SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
    // Stalwart's certificate is self-signed until it is given a real one; this hop stays on the compose network.
    tls: { rejectUnauthorized: env.MAIL_SUITE_TLS_INSECURE !== "true" },
    auth: { user: login, pass: env.MAIL_MASTER_PASSWORD },
  }));
  return { t, envelopeFrom: from };
}

/** Tests swap `send`; everything else goes through SMTP. */
export const outbox: { send: (m: Outgoing) => Promise<Sent> } = {
  async send(msg) {
    const m = mode();
    if (m.kind === "off") {
      console.warn(`[bookings] email to ${msg.to} not sent (${m.reason}): ${msg.subject}`);
      return { sent: false, reason: m.reason };
    }
    try {
      if (m.kind === "suite") await ensureMailbox(msg.from);
      const { t, envelopeFrom } = smtpFor(m, msg.from);
      await t.sendMail({
        from: { name: msg.fromName, address: envelopeFrom },
        ...(envelopeFrom.toLowerCase() !== msg.from.toLowerCase() ? { replyTo: msg.from } : {}),
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        ...(msg.ics ? { icalEvent: { method: msg.ics.method, content: msg.ics.content, filename: "appointment.ics" } } : {}),
      });
      return { sent: true };
    } catch (e) {
      console.error(`[bookings] email to ${msg.to} failed:`, (e as Error).message);
      return { sent: false, reason: (e as Error).message };
    }
  },
};
