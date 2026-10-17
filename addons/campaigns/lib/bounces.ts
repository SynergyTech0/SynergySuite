/**
 * Bounces and complaints that arrive after sending: delivery failure reports (DSNs) and spam
 * complaints (ARF) land in the sending mailbox. Every few minutes this reads new messages there,
 * finds the delivery each one is about by the X-Campaign-Delivery header or Message-ID our
 * email carried (both hold the delivery's token), and records permanent failures and complaints.
 * Other mail in the mailbox is left as it was.
 *
 * Which mailbox: CAMPAIGNS_BOUNCE_IMAP_HOST / _USER / _PASSWORD [_PORT=993] when set; otherwise,
 * when campaigns go through the suite mail server, the From mailbox there (MAIL_IMAP_HOST with the
 * master login). Off when neither applies.
 */
import { ImapFlow } from "imapflow";
import { q } from "./db";
import { mode } from "./mailer";
import { getSettings } from "./settings";
import { recordBounce, recordComplaint } from "./tracking";

type Imap = { host: string; port: number; secure: boolean; user: string; pass: string; insecureTls: boolean };

async function imapConfig(): Promise<Imap | null> {
  const env = process.env;
  if (env.CAMPAIGNS_BOUNCE_IMAP_HOST && env.CAMPAIGNS_BOUNCE_IMAP_USER && env.CAMPAIGNS_BOUNCE_IMAP_PASSWORD) {
    const port = Number(env.CAMPAIGNS_BOUNCE_IMAP_PORT) || 993;
    return { host: env.CAMPAIGNS_BOUNCE_IMAP_HOST, port, secure: port === 993, user: env.CAMPAIGNS_BOUNCE_IMAP_USER, pass: env.CAMPAIGNS_BOUNCE_IMAP_PASSWORD, insecureTls: false };
  }
  if (mode().kind === "suite" && env.MAIL_IMAP_HOST) {
    const from = (await getSettings()).fromEmail;
    if (!from) return null;
    const login = (env.MAIL_MASTER_LOGIN || "{user}%{master}").replace("{user}", from).replace("{master}", env.MAIL_MASTER_USER!);
    return { host: env.MAIL_IMAP_HOST, port: Number(env.MAIL_IMAP_PORT) || 993, secure: true, user: login, pass: env.MAIL_MASTER_PASSWORD!, insecureTls: env.MAIL_SUITE_TLS_INSECURE === "true" };
  }
  return null;
}

export type Report = { kind: "bounce"; token: string; detail: string } | { kind: "complaint"; token: string } | null;

/**
 * What a raw message reports. A DSN counts only when it says the delivery failed with a
 * permanent (5.x.x) status; delays and soft failures are ignored.
 */
export function readReport(raw: string): Report {
  const head = raw.slice(0, 200_000);
  const token = head.match(/^X-Campaign-Delivery:\s*([A-Za-z0-9_-]{16,64})\s*$/im)?.[1]
    ?? head.match(/^(?:Message-ID|Original-Message-ID):\s*<([A-Za-z0-9_-]{16,64})@[^>\s]+>/im)?.[1];
  if (!token) return null;
  if (/report-type="?feedback-report/i.test(head) || /^Feedback-Type:\s*abuse/im.test(head)) return { kind: "complaint", token };
  if (!/report-type="?delivery-status/i.test(head)) return null;
  const failed = /^Action:\s*failed/im.test(head);
  const status = head.match(/^Status:\s*(5\.\d{1,3}\.\d{1,3})/im)?.[1];
  if (!failed || !status) return null;
  const diag = head.match(/^Diagnostic-Code:\s*(.+(?:\r?\n[ \t].+)*)/im)?.[1]?.replace(/\s+/g, " ").trim();
  return { kind: "bounce", token, detail: `${status}${diag ? ` ${diag}` : ""}`.slice(0, 500) };
}

const g = globalThis as unknown as { __campaignsBounces?: NodeJS.Timeout; __campaignsBouncesRunning?: boolean };

/** Reads messages that arrived since the last check (bounce_state remembers where it got to). */
export async function checkBounces(): Promise<{ bounces: number; complaints: number }> {
  const cfg = await imapConfig();
  const out = { bounces: 0, complaints: 0 };
  if (!cfg || g.__campaignsBouncesRunning) return out;
  g.__campaignsBouncesRunning = true;
  const client = new ImapFlow({
    host: cfg.host, port: cfg.port, secure: cfg.secure, doSTARTTLS: cfg.secure ? undefined : true,
    auth: { user: cfg.user, pass: cfg.pass }, logger: false, disableAutoIdle: true,
    tls: { rejectUnauthorized: !cfg.insecureTls },
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const box = client.mailbox && typeof client.mailbox === "object" ? client.mailbox : null;
      const validity = String(box?.uidValidity ?? "0");
      const [state] = await q<{ uid_validity: string; last_uid: string }>("SELECT uid_validity, last_uid FROM bounce_state WHERE mailbox = $1", [cfg.user]);
      // The first check, or a rebuilt mailbox, starts from the last week instead of all history.
      const from = state && state.uid_validity === validity ? Number(state.last_uid) + 1 : 0;
      const uids = from
        ? ((await client.search({ uid: `${from}:*` }, { uid: true })) || []).filter((u) => u >= from)
        : (await client.search({ since: new Date(Date.now() - 7 * 86_400_000) }, { uid: true })) || [];
      let last = from ? from - 1 : 0;
      for (const uid of uids.slice(0, 2000)) {
        last = Math.max(last, uid);
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const report = readReport(msg.source.toString("utf8"));
        if (report?.kind === "bounce" && (await recordBounce(report.token, report.detail))) out.bounces++;
        if (report?.kind === "complaint" && (await recordComplaint(report.token))) out.complaints++;
      }
      if (!uids.length && !from) last = Math.max(0, Number(box?.uidNext ?? 1) - 1);
      await q(
        `INSERT INTO bounce_state (mailbox, uid_validity, last_uid) VALUES ($1, $2, $3)
         ON CONFLICT (mailbox) DO UPDATE SET uid_validity = $2, last_uid = $3`,
        [cfg.user, validity, last],
      );
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    console.error("[campaigns] bounce check failed:", (e as Error).message);
    client.close();
  } finally {
    g.__campaignsBouncesRunning = false;
  }
  return out;
}

export function startBounceChecks(): void {
  if (g.__campaignsBounces) return;
  const every = (Number(process.env.CAMPAIGNS_BOUNCE_POLL_SECONDS) || 300) * 1000;
  g.__campaignsBounces = setInterval(() => void checkBounces(), every);
  g.__campaignsBounces.unref?.();
  setTimeout(() => void checkBounces(), 30_000).unref?.();
}
