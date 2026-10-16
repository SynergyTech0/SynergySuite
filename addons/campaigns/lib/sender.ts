/**
 * The send queue. Every few seconds (instrumentation.ts) one tick:
 *
 *   1. starts campaigns whose time has come: refreshes their audience's CRM/Contacts sources,
 *      freezes the HTML and links, and queues one delivery per recipient (subscribed, in the
 *      segment, not suppressed, each address once);
 *   2. turns due automation runs into deliveries;
 *   3. sends queued deliveries, no faster than the per-minute limit in Settings, checking each
 *      person is still subscribed first. A 5xx refusal is a hard bounce (the address is cleaned
 *      and suppressed); other failures are retried with backoff, five times;
 *   4. marks campaigns with nothing left in the queue as sent.
 *
 * Claiming uses FOR UPDATE SKIP LOCKED with a lease, so two app replicas never send the same
 * delivery twice and a crash mid-send only delays a message.
 */
import { suppress } from "./audiences";
import { q, tx } from "./db";
import { mode, outbox } from "./mailer";
import { compose, mergeSubject, personalize, publicBase, type Composed, type Recipient } from "./render";
import { compileRules } from "./segments";
import { getSettings } from "./settings";
import { syncAudience } from "./sources";
import type { Block, Rules } from "./types";
import { token } from "./util";

const TICK_MS = 10_000;
const MAX_ATTEMPTS = 5;
const g = globalThis as unknown as { __campaignsTick?: Promise<TickResult>; __campaignsTimer?: NodeJS.Timeout };

export type TickResult = { started: number; automations: number; sent: number; failed: number; finished: number };

/** One pass of the queue. Overlapping calls share the pass already running. */
export function tick(): Promise<TickResult> {
  g.__campaignsTick ??= runTick().finally(() => {
    g.__campaignsTick = undefined;
  });
  return g.__campaignsTick;
}

export function startSender(): void {
  if (g.__campaignsTimer) return;
  const run = () => void tick().catch((e) => console.error("[campaigns] send queue:", (e as Error).message));
  g.__campaignsTimer = setInterval(run, TICK_MS);
  g.__campaignsTimer.unref?.();
  setTimeout(run, 5_000).unref?.();
}

async function runTick(): Promise<TickResult> {
  const started = await startDueCampaigns();
  const automations = await queueDueAutomations();
  const { sent, failed } = mode().kind === "off" ? { sent: 0, failed: 0 } : await sendQueued();
  const finished = await finishCampaigns();
  return { started, automations, sent, failed, finished };
}

// ------------------------------------------------------------------------------- start

async function startDueCampaigns(): Promise<number> {
  const due = await q<{ id: string; audience_id: string }>(
    "SELECT id, audience_id FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= now() ORDER BY scheduled_at LIMIT 5",
  );
  let n = 0;
  for (const c of due) {
    // Best-effort: a CRM or Contacts that is down shouldn't hold the campaign back.
    if (c.audience_id) await syncAudience(c.audience_id).catch((e) => console.warn("[campaigns] list sync:", (e as Error).message));
    if (await startCampaign(c.id)) n++;
  }
  return n;
}

/** Freezes the campaign and queues its recipients, once. */
export async function startCampaign(id: string): Promise<boolean> {
  return tx(async (tq) => {
    const [c] = await tq<{ id: string; audience_id: string | null; segment_id: string | null; blocks: Block[]; preheader: string; status: string }>(
      "SELECT id, audience_id, segment_id, blocks, preheader, status FROM campaigns WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!c || c.status !== "scheduled") return false;
    if (!c.audience_id) {
      await tq("UPDATE campaigns SET status = 'draft', scheduled_at = NULL WHERE id = $1", [id]);
      return false;
    }
    const composed = compose(c.blocks, { preheader: c.preheader });
    let segment = { sql: "TRUE", params: [] as unknown[] };
    if (c.segment_id) {
      const [s] = await tq<{ rules: Rules }>("SELECT rules FROM segments WHERE id = $1", [c.segment_id]);
      if (s) segment = compileRules(s.rules, 3);
    }
    // Each address once per campaign (the unique index); a token of 122 random bits per recipient.
    const rows = await tq(
      `INSERT INTO deliveries (token, campaign_id, subscriber_id, audience_id, email)
       SELECT replace(gen_random_uuid()::text, '-', ''), $1, s.id, s.audience_id, lower(s.email)
       FROM subscribers s
       WHERE s.audience_id = $2 AND s.status = 'subscribed'
         AND NOT EXISTS (SELECT 1 FROM suppressions x WHERE x.email = lower(s.email))
         AND ${segment.sql}
       ON CONFLICT DO NOTHING RETURNING id`,
      [id, c.audience_id, ...segment.params],
    );
    await tq(
      "UPDATE campaigns SET status = 'sending', html = $2, links = $3::jsonb, started_at = now(), recipients = $4, updated_at = now() WHERE id = $1",
      [id, JSON.stringify(composed), JSON.stringify(composed.links), rows.length],
    );
    return true;
  });
}

// ------------------------------------------------------------------------- automations

async function queueDueAutomations(): Promise<number> {
  return tx(async (tq) => {
    const runs = await tq<{ id: string; automation_id: string; subscriber_id: string; email: string; audience_id: string }>(
      `SELECT r.id, r.automation_id, r.subscriber_id, s.email, s.audience_id
       FROM automation_runs r JOIN automations a ON a.id = r.automation_id JOIN subscribers s ON s.id = r.subscriber_id
       WHERE r.done_at IS NULL AND r.due_at <= now() AND a.active
       ORDER BY r.due_at LIMIT 500 FOR UPDATE OF r SKIP LOCKED`,
    );
    for (const r of runs) {
      await tq(
        "INSERT INTO deliveries (token, automation_id, subscriber_id, audience_id, email) VALUES ($1, $2, $3, $4, lower($5))",
        [token(), r.automation_id, r.subscriber_id, r.audience_id, r.email],
      );
      await tq("UPDATE automation_runs SET done_at = now() WHERE id = $1", [r.id]);
    }
    return runs.length;
  });
}

// ------------------------------------------------------------------------------- send

type Claimed = {
  id: string; token: string; email: string; attempts: number; campaign_id: string | null; automation_id: string | null; audience_id: string | null;
  first_name: string | null; last_name: string | null; company: string | null; fields: Record<string, string> | null; sub_status: string | null; suppressed: boolean;
};

type Source = { composed: Composed; subject: string; fromName: string; replyTo: string; campaignId: string | null; audienceName: string };

async function sendQueued(): Promise<{ sent: number; failed: number }> {
  const settings = await getSettings();
  const budget = Math.max(1, Math.floor((settings.perMinute * TICK_MS) / 60_000));
  const claimed = await claim(budget);
  if (!claimed.length) return { sent: 0, failed: 0 };

  const sources = new Map<string, Source | null>();
  const base = publicBase();
  const domain = settings.fromEmail.split("@")[1] || "localhost";
  let sent = 0;
  let failed = 0;
  for (const d of claimed) {
    if (d.sub_status !== "subscribed" || d.suppressed) {
      await q("UPDATE deliveries SET status = 'skipped', error = $2 WHERE id = $1", [d.id, d.suppressed ? "Address is suppressed" : "No longer subscribed"]);
      continue;
    }
    const key = d.campaign_id ? `c:${d.campaign_id}` : `a:${d.automation_id}`;
    if (!sources.has(key)) sources.set(key, await loadSource(d));
    const src = sources.get(key);
    if (!src) {
      await q("UPDATE deliveries SET status = 'skipped', error = 'The email was deleted' WHERE id = $1", [d.id]);
      continue;
    }
    const r: Recipient = { email: d.email, firstName: d.first_name ?? "", lastName: d.last_name ?? "", company: d.company ?? "", fields: d.fields ?? {} };
    const unsub = `${base}/u/${d.token}`;
    const out = personalize(src.composed, r, {
      footer: {
        orgName: settings.orgName, postalAddress: settings.postalAddress, unsubscribeUrl: unsub, preferencesUrl: unsub,
        browserUrl: `${base}/v/${d.token}`,
        reason: src.audienceName ? `You are receiving this because you subscribed to ${src.audienceName}.` : undefined,
      },
      linkUrl: (i) => `${base}/t/c/${d.token}/${i}`,
      pixelUrl: `${base}/t/o/${d.token}`,
    });
    const messageId = `<${d.token}@${domain}>`;
    const res = await outbox.send({
      from: settings.fromEmail, fromName: src.fromName || settings.fromName, replyTo: src.replyTo || settings.replyTo || undefined,
      to: d.email, subject: mergeSubject(src.subject, r), html: out.html, text: out.text, messageId,
      headers: {
        "List-Unsubscribe": `<${unsub}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        "X-Campaign-Delivery": d.token,
        Precedence: "bulk",
        ...(src.campaignId ? { "Feedback-ID": `${src.campaignId.slice(0, 8)}:campaigns` } : {}),
      },
    });
    if (res.sent) {
      sent++;
      await q(
        "UPDATE deliveries SET status = 'sent', sent_at = now(), message_id = $2, error = '', links = CASE WHEN automation_id IS NOT NULL THEN $3::jsonb END WHERE id = $1",
        [d.id, res.messageId, JSON.stringify(src.composed.links)],
      );
    } else if (res.permanent) {
      failed++;
      await tx(async (tq) => {
        await tq("UPDATE deliveries SET status = 'bounced', error = $2 WHERE id = $1", [d.id, res.reason]);
        await tq("INSERT INTO events (delivery_id, campaign_id, kind) VALUES ($1, $2, 'bounce')", [d.id, d.campaign_id]);
        await suppress(tq, d.email, "bounced", res.reason, d.campaign_id);
      });
    } else if (d.attempts >= MAX_ATTEMPTS) {
      failed++;
      await q("UPDATE deliveries SET status = 'failed', error = $2 WHERE id = $1", [d.id, res.reason]);
    } else {
      // 1, 4, 9, 16 minutes.
      await q("UPDATE deliveries SET error = $2, next_try_at = now() + make_interval(mins => $3) WHERE id = $1", [d.id, res.reason, d.attempts * d.attempts]);
    }
  }
  return { sent, failed };
}

/** Leases up to `budget` due deliveries, with what's needed to address each one. */
async function claim(budget: number): Promise<Claimed[]> {
  const ids = await tx(async (tq) => {
    const rows = await tq<{ id: string }>(
      `SELECT d.id FROM deliveries d LEFT JOIN campaigns c ON c.id = d.campaign_id
       WHERE d.status = 'queued' AND d.next_try_at <= now() AND (d.campaign_id IS NULL OR c.status = 'sending')
       ORDER BY d.id LIMIT $1 FOR UPDATE OF d SKIP LOCKED`,
      [budget],
    );
    if (rows.length) await tq("UPDATE deliveries SET next_try_at = now() + interval '10 minutes', attempts = attempts + 1 WHERE id = ANY($1::bigint[])", [rows.map((r) => r.id)]);
    return rows.map((r) => r.id);
  });
  if (!ids.length) return [];
  return q<Claimed>(
    `SELECT d.id, d.token, d.email, d.attempts, d.campaign_id, d.automation_id, d.audience_id,
       s.first_name, s.last_name, s.company, s.fields, s.status AS sub_status,
       EXISTS (SELECT 1 FROM suppressions x WHERE x.email = d.email) AS suppressed
     FROM deliveries d LEFT JOIN subscribers s ON s.id = d.subscriber_id WHERE d.id = ANY($1::bigint[]) ORDER BY d.id`,
    [ids],
  );
}

async function loadSource(d: Claimed): Promise<Source | null> {
  const audienceName = d.audience_id ? (await q<{ name: string }>("SELECT name FROM audiences WHERE id = $1", [d.audience_id]))[0]?.name ?? "" : "";
  if (d.campaign_id) {
    const [c] = await q<{ html: string | null; subject: string; from_name: string; reply_to: string }>(
      "SELECT html, subject, from_name, reply_to FROM campaigns WHERE id = $1", [d.campaign_id],
    );
    if (!c?.html) return null;
    return { composed: JSON.parse(c.html) as Composed, subject: c.subject, fromName: c.from_name, replyTo: c.reply_to, campaignId: d.campaign_id, audienceName };
  }
  const [a] = await q<{ blocks: Block[]; subject: string; preheader: string }>("SELECT blocks, subject, preheader FROM automations WHERE id = $1", [d.automation_id]);
  if (!a) return null;
  return { composed: compose(a.blocks, { preheader: a.preheader }), subject: a.subject, fromName: "", replyTo: "", campaignId: null, audienceName };
}

async function finishCampaigns(): Promise<number> {
  const rows = await q(
    `UPDATE campaigns c SET status = 'sent', finished_at = now(), updated_at = now()
     WHERE c.status = 'sending' AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.campaign_id = c.id AND d.status = 'queued')
     RETURNING id`,
  );
  return rows.length;
}
