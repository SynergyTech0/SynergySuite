import nodemailer from "nodemailer";

/**
 * SMTP sender for meeting invites. Configured for the GoDaddy noreply@ mailbox via env:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 * GoDaddy: smtpout.secureserver.net:465 (SSL) — or smtp.office365.com:587 if the domain is on M365.
 *
 * Until those are set the app still schedules meetings and returns join links; sends are logged and
 * skipped rather than failing the request, so scheduling works before the mailbox exists.
 * Demo mode (DEMO_MODE=1) never sends: a public demo must not mail outside addresses.
 */
let _tx: nodemailer.Transporter | null = null;

export function emailConfigured(): boolean {
  if (process.env.DEMO_MODE === "1") return false;
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function transport(): nodemailer.Transporter {
  if (!_tx) {
    const port = Number(process.env.SMTP_PORT || 465);
    _tx = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return _tx;
}

export type Invite = {
  to: string;
  subject: string;
  html: string;
  text: string;
  ics: string;
  method: "REQUEST" | "CANCEL";
};

export async function sendInvite(inv: Invite): Promise<{ sent: boolean; reason?: string }> {
  if (!emailConfigured()) {
    console.warn(`[email] SMTP not configured — invite to ${inv.to} not sent (queued): ${inv.subject}`);
    return { sent: false, reason: "smtp-not-configured" };
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  try {
    await transport().sendMail({
      from: `SynergyMeet <${from}>`,
      to: inv.to,
      subject: inv.subject,
      text: inv.text,
      html: inv.html,
      icalEvent: {
        method: inv.method,
        content: inv.ics,
        filename: "invite.ics",
      },
    });
    return { sent: true };
  } catch (e) {
    console.error(`[email] send to ${inv.to} failed:`, e);
    return { sent: false, reason: e instanceof Error ? e.message : "send-failed" };
  }
}
