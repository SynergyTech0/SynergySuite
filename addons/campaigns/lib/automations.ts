/**
 * Automations: one email sent a set time after someone joins an audience (a welcome email) or is
 * given a tag. Joining queues an automation_runs row due after the delay; the sender's tick
 * turns due runs into deliveries (lib/sender.ts). A run happens at most once per person.
 */
import { cleanBlocks } from "./blocks";
import { q, type Tq } from "./db";
import { assertCanEdit } from "./members";
import type { Automation, Block, Ctx } from "./types";
import { UserError, isUuid, oneOf, required, text } from "./util";

type Row = {
  id: string; name: string; audience_id: string; audience_name: string | null; trigger: "subscribed" | "tagged"; tag: string;
  delay_minutes: number; subject: string; preheader: string; blocks: Block[]; active: boolean; updated_at: Date;
  sent: number; waiting: number;
};

const SELECT = `SELECT a.*, (SELECT name FROM audiences WHERE id = a.audience_id) AS audience_name,
  (SELECT count(*)::int FROM deliveries d WHERE d.automation_id = a.id AND d.status = 'sent') AS sent,
  (SELECT count(*)::int FROM automation_runs r WHERE r.automation_id = a.id AND r.done_at IS NULL) AS waiting
  FROM automations a`;

const toAutomation = (r: Row): Automation => ({
  id: r.id, name: r.name, audienceId: r.audience_id, audienceName: r.audience_name, trigger: r.trigger, tag: r.tag,
  delayMinutes: r.delay_minutes, subject: r.subject, preheader: r.preheader, blocks: r.blocks ?? [], active: r.active,
  sent: r.sent, waiting: r.waiting, updatedAt: new Date(r.updated_at).toISOString(),
});

export async function listAutomations(): Promise<Automation[]> {
  return (await q<Row>(`${SELECT} ORDER BY a.updated_at DESC`)).map(toAutomation);
}

export async function getAutomation(id: string): Promise<Automation> {
  if (!isUuid(id)) throw new UserError("Automation not found", 404);
  const [r] = await q<Row>(`${SELECT} WHERE a.id = $1`, [id]);
  if (!r) throw new UserError("Automation not found", 404);
  return toAutomation(r);
}

function fields(b: Record<string, unknown>, old?: Automation) {
  const pick = <T>(k: string, f: (v: unknown) => T, fallback: T): T => (b[k] === undefined ? fallback : f(b[k]));
  const delay = pick("delayMinutes", (v) => Number(v), old?.delayMinutes ?? 0);
  if (!Number.isInteger(delay) || delay < 0 || delay > 525_600) throw new UserError("The delay must be 0 minutes to a year");
  const trigger = pick("trigger", (v) => oneOf(v, ["subscribed", "tagged"] as const, "subscribed", "trigger"), old?.trigger ?? "subscribed");
  const tag = pick("tag", (v) => text(v, 40).toLowerCase(), old?.tag ?? "");
  if (trigger === "tagged" && !tag) throw new UserError("Pick the tag that starts this automation");
  return {
    name: pick("name", (v) => required(v, "A name", 120), old?.name ?? ""),
    audienceId: pick("audienceId", (v) => (isUuid(v) ? v : ""), old?.audienceId ?? ""),
    trigger, tag, delay,
    subject: pick("subject", (v) => text(v, 200), old?.subject ?? ""),
    preheader: pick("preheader", (v) => text(v, 200), old?.preheader ?? ""),
    blocks: pick("blocks", cleanBlocks, old?.blocks ?? []),
  };
}

export async function createAutomation(ctx: Ctx, b: Record<string, unknown>): Promise<Automation> {
  assertCanEdit(ctx);
  const f = fields(b);
  if (!f.audienceId) throw new UserError("Pick an audience");
  const [r] = await q<{ id: string }>(
    `INSERT INTO automations (name, audience_id, trigger, tag, delay_minutes, subject, preheader, blocks, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $9) RETURNING id`,
    [f.name, f.audienceId, f.trigger, f.tag, f.delay, f.subject, f.preheader, JSON.stringify(f.blocks), ctx.email],
  );
  return getAutomation(r.id);
}

export async function updateAutomation(ctx: Ctx, id: string, b: Record<string, unknown>): Promise<Automation> {
  assertCanEdit(ctx);
  const old = await getAutomation(id);
  const f = fields(b, old);
  const active = b.active === undefined ? old.active : Boolean(b.active);
  if (active && (!f.subject || !f.blocks.length)) throw new UserError("Give the email a subject and some content before turning it on");
  await q(
    `UPDATE automations SET name = $2, audience_id = $3, trigger = $4, tag = $5, delay_minutes = $6, subject = $7, preheader = $8,
       blocks = $9::jsonb, active = $10, updated_at = now(), updated_by = $11 WHERE id = $1`,
    [id, f.name, f.audienceId || old.audienceId, f.trigger, f.tag, f.delay, f.subject, f.preheader, JSON.stringify(f.blocks), active, ctx.email],
  );
  // Turning it off drops the people still waiting; turning it on later only catches new joiners.
  if (!active) await q("DELETE FROM automation_runs WHERE automation_id = $1 AND done_at IS NULL", [id]);
  return getAutomation(id);
}

export async function deleteAutomation(ctx: Ctx, id: string): Promise<void> {
  assertCanEdit(ctx);
  await getAutomation(id);
  await q("DELETE FROM automations WHERE id = $1", [id]);
}

/** Queues the active automations these joins and new tags start. Runs inside the caller's transaction. */
export async function queueAutomations(tq: Tq, audienceId: string, joined: string[], tagged: { id: string; tags: string[] }[]): Promise<void> {
  const autos = await tq<{ id: string; trigger: string; tag: string; delay_minutes: number }>(
    "SELECT id, trigger, tag, delay_minutes FROM automations WHERE audience_id = $1 AND active",
    [audienceId],
  );
  for (const a of autos) {
    const who = a.trigger === "subscribed" ? joined : tagged.filter((t) => t.tags.includes(a.tag)).map((t) => t.id);
    if (!who.length) continue;
    await tq(
      `INSERT INTO automation_runs (automation_id, subscriber_id, due_at)
       SELECT $1, unnest($2::uuid[]), now() + make_interval(mins => $3) ON CONFLICT (automation_id, subscriber_id) DO NOTHING`,
      [a.id, who, a.delay_minutes],
    );
  }
}
