import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { imapConfig } from "./mailer";
import { receive, type Inbound } from "./tickets";

/**
 * Checks the support mailbox every couple of minutes and files unread mail as tickets or
 * ticket replies, then marks it read. Started once per server from instrumentation.ts; does
 * nothing unless DESK_IMAP_* is set.
 */

const g = globalThis as unknown as { __deskPoller?: NodeJS.Timeout | "off" };

const firstAddress = (p: ParsedMail) => p.from?.value?.[0];

/** Out-of-office and other robot mail would reopen tickets for nothing. */
function isAutomatic(p: ParsedMail): boolean {
  const auto = String(p.headers.get("auto-submitted") ?? "").toLowerCase();
  if (auto && auto !== "no") return true;
  const precedence = String(p.headers.get("precedence") ?? "").toLowerCase();
  return ["bulk", "junk", "auto_reply"].includes(precedence) || p.headers.has("x-autoreply") || p.headers.has("x-autorespond");
}

export function toInbound(p: ParsedMail): Inbound {
  const from = firstAddress(p);
  return {
    from: from?.address || "",
    fromName: from?.name || "",
    subject: p.subject || "(no subject)",
    text: p.text || "",
    messageId: p.messageId || null,
    inReplyTo: p.inReplyTo || null,
    references: p.references || null,
  };
}

let running = false;

export async function pollOnce(): Promise<number> {
  const cfg = imapConfig();
  if (!cfg || running) return 0;
  running = true;
  let filed = 0;
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    doSTARTTLS: cfg.secure ? undefined : true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    disableAutoIdle: true,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock(cfg.folder);
    try {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      for (const uid of uids) {
        try {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (msg && msg.source) {
            const parsed = await simpleParser(msg.source);
            const sender = (firstAddress(parsed)?.address || "").toLowerCase();
            // Skip robots and our own mailbox (a reply we sent that came back to us).
            if (!isAutomatic(parsed) && sender !== cfg.user.toLowerCase()) {
              if (await receive(toInbound(parsed))) filed++;
            }
          }
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        } catch (e) {
          // Left unread, so the next check tries it again; the rest of the mailbox carries on.
          console.error(`[desk] couldn't file message ${uid}:`, (e as Error).message);
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    console.error("[desk] mailbox check failed:", (e as Error).message);
    client.close();
  } finally {
    running = false;
  }
  return filed;
}

export function startPoller(): void {
  if (g.__deskPoller) return;
  const cfg = imapConfig();
  if (!cfg) {
    g.__deskPoller = "off";
    console.log("[desk] email intake is off (DESK_IMAP_HOST/USER/PASSWORD not set)");
    return;
  }
  g.__deskPoller = setInterval(() => void pollOnce(), cfg.everyMs);
  g.__deskPoller.unref?.();
  void pollOnce();
  console.log(`[desk] checking the support mailbox every ${cfg.everyMs / 1000}s`);
}
