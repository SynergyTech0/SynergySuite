/**
 * Campaigns: one email to an audience (or one of its segments). A draft is edited freely; once it
 * is scheduled or sent the sender (lib/sender.ts) freezes its HTML and links and queues one
 * delivery per recipient. Sending can be paused, resumed or canceled while it runs.
 */
import { cleanBlocks, starterBlocks } from "./blocks";
import { q, tx } from "./db";
import { keepHeld } from "./ediscovery";
import { outbox } from "./mailer";
import { assertCanEdit } from "./members";
import { compose, mergeSubject, mergeUrl, personalize, publicBase, type Recipient } from "./render";
import { countMatching, getSegment } from "./segments";
import { getSettings, sendBlockers } from "./settings";
import type { Block, Campaign, CampaignStatus, Ctx, Stats } from "./types";
import { UserError, isEmail, isUuid, required, text, timestamp } from "./util";

type Row = {
  id: string; name: string; audience_id: string | null; audience_name: string | null; segment_id: string | null; segment_name: string | null;
  subject: string; preheader: string; from_name: string; reply_to: string; blocks: Block[]; status: CampaignStatus;
  scheduled_at: Date | null; started_at: Date | null; finished_at: Date | null; recipients: number;
  created_at: Date; updated_at: Date; created_by: string | null;
};

const SELECT = `SELECT c.id, c.name, c.audience_id, c.segment_id, c.subject, c.preheader, c.from_name, c.reply_to, c.blocks, c.status,
  c.scheduled_at, c.started_at, c.finished_at, c.recipients, c.created_at, c.updated_at, c.created_by,
  (SELECT name FROM audiences WHERE id = c.audience_id) AS audience_name,
  (SELECT name FROM segments WHERE id = c.segment_id) AS segment_name
  FROM campaigns c`;

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

const toCampaign = (r: Row): Campaign => ({
  id: r.id, name: r.name, audienceId: r.audience_id, audienceName: r.audience_name, segmentId: r.segment_id, segmentName: r.segment_name,
  subject: r.subject, preheader: r.preheader, fromName: r.from_name, replyTo: r.reply_to, blocks: r.blocks ?? [], status: r.status,
  scheduledAt: iso(r.scheduled_at), startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), recipients: r.recipients,
  createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(), createdBy: r.created_by,
});

export async function stats(campaignId: string): Promise<Stats> {
  const [d] = await q<Record<string, number>>(
    `SELECT count(*)::int AS recipients,
       count(*) FILTER (WHERE status = 'queued')::int AS queued,
       count(*) FILTER (WHERE status = 'sent')::int AS sent,
       count(*) FILTER (WHERE status = 'failed')::int AS failed,
       count(*) FILTER (WHERE status = 'bounced')::int AS bounced,
       count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
       count(opened_at)::int AS unique_opens,
       count(clicked_at)::int AS unique_clicks,
       count(unsubscribed_at)::int AS unsubscribes
     FROM deliveries WHERE campaign_id = $1`,
    [campaignId],
  );
  const [e] = await q<Record<string, number>>(
    `SELECT count(*) FILTER (WHERE kind = 'open')::int AS opens, count(*) FILTER (WHERE kind = 'click')::int AS clicks,
       count(*) FILTER (WHERE kind = 'complaint')::int AS complaints
     FROM events WHERE campaign_id = $1`,
    [campaignId],
  );
  return {
    recipients: d.recipients, queued: d.queued, sent: d.sent, failed: d.failed, bounced: d.bounced, skipped: d.skipped,
    opens: e.opens, uniqueOpens: d.unique_opens, clicks: e.clicks, uniqueClicks: d.unique_clicks, unsubscribes: d.unsubscribes, complaints: e.complaints,
  };
}

export async function listCampaigns(): Promise<Campaign[]> {
  const out = (await q<Row>(`${SELECT} ORDER BY coalesce(c.started_at, c.scheduled_at, c.updated_at) DESC`)).map(toCampaign);
  for (const c of out) if (c.status !== "draft") c.stats = await stats(c.id);
  return out;
}

export async function getCampaign(id: string): Promise<Campaign> {
  if (!isUuid(id)) throw new UserError("Campaign not found", 404);
  const [r] = await q<Row>(`${SELECT} WHERE c.id = $1`, [id]);
  if (!r) throw new UserError("Campaign not found", 404);
  const c = toCampaign(r);
  if (c.status !== "draft") c.stats = await stats(c.id);
  return c;
}

export async function createCampaign(ctx: Ctx, b: Record<string, unknown>): Promise<Campaign> {
  assertCanEdit(ctx);
  let blocks = b.blocks === undefined ? starterBlocks() : cleanBlocks(b.blocks);
  let subject = text(b.subject, 200);
  let preheader = text(b.preheader, 200);
  if (isUuid(b.templateId)) {
    const [t] = await q<{ blocks: Block[]; subject: string; preheader: string }>("SELECT blocks, subject, preheader FROM templates WHERE id = $1", [b.templateId]);
    if (t) ({ blocks, subject, preheader } = { blocks: t.blocks, subject: subject || t.subject, preheader: preheader || t.preheader });
  }
  const [r] = await q<{ id: string }>(
    `INSERT INTO campaigns (name, audience_id, segment_id, subject, preheader, blocks, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7) RETURNING id`,
    [required(b.name, "A name", 160), isUuid(b.audienceId) ? b.audienceId : null, isUuid(b.segmentId) ? b.segmentId : null, subject, preheader, JSON.stringify(blocks), ctx.email],
  );
  return getCampaign(r.id);
}

/** Copies any campaign, sent or not, as a new draft. */
export async function duplicateCampaign(ctx: Ctx, id: string): Promise<Campaign> {
  const c = await getCampaign(id);
  return createCampaign(ctx, { name: `${c.name} (copy)`.slice(0, 160), audienceId: c.audienceId, segmentId: c.segmentId, subject: c.subject, preheader: c.preheader, blocks: c.blocks });
}

export async function updateCampaign(ctx: Ctx, id: string, b: Record<string, unknown>): Promise<Campaign> {
  assertCanEdit(ctx);
  const c = await getCampaign(id);
  if (c.status !== "draft") throw new UserError("Only a draft can be changed. Unschedule it first, or duplicate it.");
  const audienceId = b.audienceId === undefined ? c.audienceId : isUuid(b.audienceId) ? b.audienceId : null;
  let segmentId = b.segmentId === undefined ? c.segmentId : isUuid(b.segmentId) ? b.segmentId : null;
  if (segmentId) {
    const s = await getSegment(segmentId).catch(() => null);
    if (!s || s.audienceId !== audienceId) segmentId = null;
  }
  const replyTo = b.replyTo === undefined ? c.replyTo : text(b.replyTo, 254).toLowerCase();
  if (replyTo && !isEmail(replyTo)) throw new UserError("Reply-To must be an email address");
  await q(
    `UPDATE campaigns SET name = $2, audience_id = $3, segment_id = $4, subject = $5, preheader = $6, from_name = $7, reply_to = $8,
       blocks = $9::jsonb, updated_at = now(), updated_by = $10 WHERE id = $1`,
    [
      id,
      b.name === undefined ? c.name : required(b.name, "A name", 160),
      audienceId, segmentId,
      b.subject === undefined ? c.subject : text(b.subject, 200),
      b.preheader === undefined ? c.preheader : text(b.preheader, 200),
      b.fromName === undefined ? c.fromName : text(b.fromName, 120),
      replyTo,
      JSON.stringify(b.blocks === undefined ? c.blocks : cleanBlocks(b.blocks)),
      ctx.email,
    ],
  );
  return getCampaign(id);
}

export async function deleteCampaign(ctx: Ctx, id: string): Promise<void> {
  assertCanEdit(ctx);
  const c = await getCampaign(id);
  if (c.status === "sending" || c.status === "paused") throw new UserError("Cancel the send before deleting the campaign");
  await tx(async (tq) => {
    await keepHeld(tq, ctx.email, "campaign", [id]);
    await tq("DELETE FROM campaigns WHERE id = $1", [id]);
  });
}

/** Who a campaign would go to right now: subscribed, in the segment, not suppressed. */
export async function audienceSize(audienceId: string, segmentId: string | null): Promise<number> {
  if (segmentId) {
    const s = await getSegment(segmentId);
    return countMatching(audienceId, s.rules);
  }
  const [r] = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM subscribers s WHERE s.audience_id = $1 AND s.status = 'subscribed'
       AND NOT EXISTS (SELECT 1 FROM suppressions x WHERE x.email = lower(s.email))`,
    [audienceId],
  );
  return r.n;
}

/** What has to be fixed before this campaign can go. */
export async function readiness(c: Campaign): Promise<{ problems: string[]; recipients: number }> {
  const problems = sendBlockers(await getSettings());
  if (!c.audienceId) problems.push("Pick an audience");
  if (!c.subject) problems.push("Write a subject line");
  if (!c.blocks.length) problems.push("Add some content");
  const recipients = c.audienceId ? await audienceSize(c.audienceId, c.segmentId) : 0;
  if (c.audienceId && !recipients) problems.push("Nobody in the audience is subscribed");
  return { problems, recipients };
}

/** Sends now (when = null) or at a time. The sender's next tick picks it up. */
export async function schedule(ctx: Ctx, id: string, when: unknown): Promise<Campaign> {
  assertCanEdit(ctx);
  const c = await getCampaign(id);
  if (c.status !== "draft") throw new UserError("This campaign has already been scheduled or sent");
  const at = timestamp(when, "send time");
  if (at && Date.parse(at) < Date.now() - 60_000) throw new UserError("Pick a time in the future");
  const { problems } = await readiness(c);
  if (problems.length) throw new UserError(problems.join(". "));
  await q("UPDATE campaigns SET status = 'scheduled', scheduled_at = coalesce($2::timestamptz, now()), updated_at = now(), updated_by = $3 WHERE id = $1 AND status = 'draft'", [id, at, ctx.email]);
  const { tick } = await import("./sender");
  if (!at) void tick().catch((e) => console.error("[campaigns] send:", (e as Error).message));
  return getCampaign(id);
}

/** Back to a draft before it starts. */
export async function unschedule(ctx: Ctx, id: string): Promise<Campaign> {
  assertCanEdit(ctx);
  const [r] = await q("UPDATE campaigns SET status = 'draft', scheduled_at = NULL, updated_at = now(), updated_by = $2 WHERE id = $1 AND status = 'scheduled' RETURNING id", [id, ctx.email]);
  if (!r) throw new UserError("Only a scheduled campaign that hasn't started can go back to draft");
  return getCampaign(id);
}

export async function pause(ctx: Ctx, id: string): Promise<Campaign> {
  assertCanEdit(ctx);
  const [r] = await q("UPDATE campaigns SET status = 'paused', updated_at = now(), updated_by = $2 WHERE id = $1 AND status = 'sending' RETURNING id", [id, ctx.email]);
  if (!r) throw new UserError("Only a campaign that is sending can be paused");
  return getCampaign(id);
}

export async function resume(ctx: Ctx, id: string): Promise<Campaign> {
  assertCanEdit(ctx);
  const [r] = await q("UPDATE campaigns SET status = 'sending', updated_at = now(), updated_by = $2 WHERE id = $1 AND status = 'paused' RETURNING id", [id, ctx.email]);
  if (!r) throw new UserError("Only a paused campaign can be resumed");
  return getCampaign(id);
}

/** Stops a send for good: whoever hasn't been sent to yet won't be. */
export async function cancel(ctx: Ctx, id: string): Promise<Campaign> {
  assertCanEdit(ctx);
  await tx(async (tq) => {
    const [r] = await tq("UPDATE campaigns SET status = 'canceled', finished_at = now(), updated_at = now(), updated_by = $2 WHERE id = $1 AND status IN ('sending','paused','scheduled') RETURNING id", [id, ctx.email]);
    if (!r) throw new UserError("This campaign isn't sending");
    await tq("UPDATE deliveries SET status = 'skipped', error = 'Campaign canceled' WHERE campaign_id = $1 AND status = 'queued'", [id]);
  });
  return getCampaign(id);
}

/** The sender's own details stand in for a subscriber in previews and tests. */
function sample(ctx: Ctx): Recipient {
  const [first, ...rest] = ctx.name.split(/\s+/);
  return { email: ctx.email, firstName: first ?? "", lastName: rest.join(" "), company: "", fields: {} };
}

export async function preview(ctx: Ctx, b: { blocks?: unknown; preheader?: unknown; subject?: unknown }): Promise<{ html: string; subject: string }> {
  const s = await getSettings();
  const composed = compose(cleanBlocks(b.blocks), { preheader: text(b.preheader, 200) });
  const r = sample(ctx);
  const out = personalize(composed, r, {
    footer: { orgName: s.orgName || "Your organization", postalAddress: s.postalAddress || "Your postal address", unsubscribeUrl: "#", preferencesUrl: "#", browserUrl: "#" },
    linkUrl: (_i, url) => mergeUrl(url, r),
  });
  return { html: out.html, subject: mergeSubject(text(b.subject, 200), r) };
}

/** Sends one copy to up to five addresses, marked as a test, untracked. */
export async function sendTest(ctx: Ctx, id: string, to: unknown): Promise<{ sent: string[]; failed: { to: string; reason: string }[] }> {
  assertCanEdit(ctx);
  const c = await getCampaign(id);
  const list = (Array.isArray(to) ? to : String(to ?? "").split(/[\s,;]+/)).map((x) => text(x, 254).toLowerCase()).filter(Boolean);
  if (!list.length) throw new UserError("Enter an address to send the test to");
  if (list.length > 5) throw new UserError("Send a test to at most five addresses");
  for (const x of list) if (!isEmail(x)) throw new UserError(`"${x.slice(0, 60)}" is not an email address`);
  const s = await getSettings();
  if (!isEmail(s.fromEmail)) throw new UserError("Set the From address in Settings first");
  if (s.sender.mode === "off") throw new UserError(s.sender.detail);
  const composed = compose(c.blocks, { preheader: c.preheader });
  const r = sample(ctx);
  const out = personalize(composed, r, {
    footer: { orgName: s.orgName, postalAddress: s.postalAddress, unsubscribeUrl: `${publicBase()}/` },
    linkUrl: (_i, url) => mergeUrl(url, r),
  });
  const result = { sent: [] as string[], failed: [] as { to: string; reason: string }[] };
  for (const addr of list) {
    const res = await outbox.send({
      from: s.fromEmail, fromName: c.fromName || s.fromName, replyTo: c.replyTo || s.replyTo || undefined, to: addr,
      subject: `[Test] ${mergeSubject(c.subject || "(no subject)", r)}`, html: out.html, text: out.text,
      headers: {}, messageId: `<test-${crypto.randomUUID()}@${s.fromEmail.split("@")[1]}>`,
    });
    if (res.sent) result.sent.push(addr);
    else result.failed.push({ to: addr, reason: res.reason });
  }
  return result;
}

export type LinkStat = { url: string; clicks: number; people: number };
export type RecipientRow = { email: string; status: string; error: string; sentAt: string | null; openedAt: string | null; clickedAt: string | null; unsubscribedAt: string | null };

/** The report: per-link clicks and the recipient list. */
export async function report(id: string, f: { filter?: string; offset?: number } = {}): Promise<{ links: LinkStat[]; recipients: RecipientRow[]; total: number }> {
  const [c] = await q<{ links: string[] }>("SELECT links FROM campaigns WHERE id = $1", [id]);
  if (!c) throw new UserError("Campaign not found", 404);
  const clicks = await q<{ url: string; clicks: number; people: number }>(
    "SELECT url, count(*)::int AS clicks, count(DISTINCT delivery_id)::int AS people FROM events WHERE campaign_id = $1 AND kind = 'click' GROUP BY url",
    [id],
  );
  const byUrl = new Map(clicks.map((r) => [r.url, r]));
  const links = (c.links ?? []).map((url) => ({ url, clicks: byUrl.get(url)?.clicks ?? 0, people: byUrl.get(url)?.people ?? 0 }));
  const where: Record<string, string> = {
    opened: "opened_at IS NOT NULL", clicked: "clicked_at IS NOT NULL", unopened: "status = 'sent' AND opened_at IS NULL",
    bounced: "status IN ('bounced','failed')", unsubscribed: "unsubscribed_at IS NOT NULL",
  };
  const cond = where[f.filter ?? ""] ?? "TRUE";
  const rows = await q<{ email: string; status: string; error: string; sent_at: Date | null; opened_at: Date | null; clicked_at: Date | null; unsubscribed_at: Date | null; total: number }>(
    `SELECT email, status, error, sent_at, opened_at, clicked_at, unsubscribed_at, count(*) OVER ()::int AS total
     FROM deliveries WHERE campaign_id = $1 AND ${cond} ORDER BY id LIMIT 200 OFFSET $2`,
    [id, Math.max(f.offset ?? 0, 0)],
  );
  return {
    links,
    recipients: rows.map((r) => ({ email: r.email, status: r.status, error: r.error, sentAt: iso(r.sent_at), openedAt: iso(r.opened_at), clickedAt: iso(r.clicked_at), unsubscribedAt: iso(r.unsubscribed_at) })),
    total: rows[0]?.total ?? 0,
  };
}
