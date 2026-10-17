import nodemailer, { type Transporter } from "nodemailer";
import { randomBytes } from "node:crypto";

/**
 * How Sign sends signing requests, reminders and completed documents. Either:
 *
 *   SIGN_SMTP_HOST, SIGN_SMTP_USER, SIGN_SMTP_PASSWORD [SIGN_SMTP_PORT=587, SIGN_SMTP_FROM]
 *     one outside mailbox (any provider) sends everything; or
 *   MAIL_SMTP_HOST, MAIL_MASTER_USER, MAIL_MASTER_PASSWORD (what compose sets for the suite's Stalwart)
 *     Sign sends from the suite mailbox SIGN_MAIL_FROM (default sign@MAIL_DOMAIN or sign@SUITE_DOMAIN),
 *     created on Stalwart the first time when MAIL_ADMIN_URL is set, as Bookings and Mail do.
 *
 * With neither (or EMAIL_SEND_ARMED=0), nothing leaves the machine: each message is written to
 * ./dev-mail/*.eml so the signing flow still completes and the link can be opened from there.
 */

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: string | Buffer; // Buffer: attach bytes we hold (e.g. the freshly signed PDF)
  }>;
}

type Mode = { kind: "smtp" } | { kind: "suite" } | { kind: "sink"; reason: string };

export function mailMode(env: NodeJS.ProcessEnv = process.env): Mode {
  if (env.EMAIL_SEND_ARMED === "0") return { kind: "sink", reason: "OUTBOUND DISARMED (EMAIL_SEND_ARMED=0)" };
  if (env.DEMO_MODE === "1") return { kind: "sink", reason: "demo mode" };
  if (env.SIGN_SMTP_HOST && env.SIGN_SMTP_USER && env.SIGN_SMTP_PASSWORD) return { kind: "smtp" };
  if (env.MAIL_SMTP_HOST && env.MAIL_MASTER_USER && env.MAIL_MASTER_PASSWORD) return { kind: "suite" };
  return { kind: "sink", reason: "no mail server configured" };
}

/** The suite mailbox Sign sends from. */
export function suiteSender(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SIGN_MAIL_FROM) return env.SIGN_MAIL_FROM;
  const domain = env.MAIL_DOMAIN || env.SUITE_DOMAIN || "localhost";
  return `sign@${domain}`;
}

const g = globalThis as unknown as { __signSmtp?: Map<string, Transporter> };

function transport(key: string, make: () => Transporter): Transporter {
  g.__signSmtp ??= new Map();
  let t = g.__signSmtp.get(key);
  if (!t) g.__signSmtp.set(key, (t = make()));
  return t;
}

function smtpFor(m: Mode): { t: Transporter; from: string } {
  const env = process.env;
  if (m.kind === "smtp") {
    const port = Number(env.SIGN_SMTP_PORT) || 587;
    const t = transport("smtp", () =>
      nodemailer.createTransport({
        host: env.SIGN_SMTP_HOST,
        port,
        secure: port === 465,
        requireTLS: port !== 465,
        auth: { user: env.SIGN_SMTP_USER, pass: env.SIGN_SMTP_PASSWORD },
      }),
    );
    return { t, from: env.SIGN_SMTP_FROM || env.SIGN_SMTP_USER! };
  }
  // The suite mail server lets one trusted service login act for any mailbox, as Mail does.
  const from = suiteSender();
  const port = Number(env.MAIL_SMTP_PORT) || 465;
  const login = (env.MAIL_MASTER_LOGIN || "{user}%{master}").replace("{user}", from).replace("{master}", env.MAIL_MASTER_USER!);
  const t = transport(`suite:${from}`, () =>
    nodemailer.createTransport({
      host: env.MAIL_SMTP_HOST,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      // Stalwart's certificate is self-signed until it is given a real one; this hop stays on the compose network.
      tls: { rejectUnauthorized: env.MAIL_SUITE_TLS_INSECURE !== "true" },
      auth: { user: login, pass: env.MAIL_MASTER_PASSWORD },
    }),
  );
  return { t, from };
}

const knownMailboxes = new Set<string>();

/** Makes sure Sign's suite mailbox exists on Stalwart (MAIL_ADMIN_URL with MAIL_ADMIN_USER / MAIL_ADMIN_PASSWORD). */
async function ensureMailbox(email: string): Promise<void> {
  const url = process.env.MAIL_ADMIN_URL;
  if (!url || knownMailboxes.has(email)) return;
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const domainId = await first(url, "x:Domain/query", { filter: { name: email.slice(at + 1) } });
  if (!domainId) throw new Error(`the suite mail server doesn't host ${email}`);
  if (!(await first(url, "x:Account/query", { filter: { name: local, domainId } }))) {
    await jmap(url, [
      [
        "x:Account/set",
        {
          create: {
            u: {
              "@type": "User",
              name: local,
              domainId,
              description: "Synergy Sign",
              credentials: { "0": { "@type": "Password", secret: randomBytes(24).toString("base64url") } },
            },
          },
        },
        "c",
      ],
    ]);
    if (!(await first(url, "x:Account/query", { filter: { name: local, domainId } }))) throw new Error(`couldn't create the mailbox ${email}`);
  }
  knownMailboxes.add(email);
}

async function first(url: string, method: string, args: object): Promise<string | undefined> {
  return (await jmap(url, [[method, args, "q"]]))?.ids?.[0];
}

async function jmap(url: string, methodCalls: unknown[]) {
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

async function writeToSink(msg: EmailOptions, reason: string) {
  const fs = await import("fs/promises");
  const path = await import("path");
  const dir = process.env.SIGN_DEV_MAIL_DIR || path.join(process.cwd(), "dev-mail");
  await fs.mkdir(dir, { recursive: true });
  const safe = String(msg.subject).replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
  const file = path.join(dir, `${Date.now()}-${safe}.eml`);
  await fs.writeFile(
    file,
    `To: ${msg.to}\nSubject: ${msg.subject}\n` +
      `X-Attachments: ${(msg.attachments ?? []).map((a) => a.filename).join(", ") || "(none)"}\n` +
      `\n${msg.html}\n`,
    "utf8",
  );
  console.warn(`[email] ${reason}: wrote ${file} instead of sending`);
  return { success: true, messageId: `dev-sink:${path.basename(file)}`, devSink: file };
}

export async function sendEmail(options: EmailOptions | string, subject?: string, html?: string) {
  // Supports both sendEmail(to, subject, html) and sendEmail({ to, subject, html, attachments }).
  let msg: EmailOptions;
  if (typeof options === "string") {
    if (subject == null || html == null) throw new Error("subject and html are required when using the old signature");
    msg = { to: options, subject, html };
  } else {
    msg = options;
  }

  const m = mailMode();
  if (m.kind === "sink") return writeToSink(msg, m.reason);

  if (m.kind === "suite") await ensureMailbox(suiteSender());
  const { t, from } = smtpFor(m);
  try {
    const info = await t.sendMail({
      from: { name: "Synergy Sign", address: from },
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      attachments: msg.attachments,
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`[email] sending to ${msg.to} failed:`, (error as Error).message);
    throw error;
  }
}
