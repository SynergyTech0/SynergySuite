import { q, now } from './db';
import { randomBytes } from 'crypto';

export { now };

export const newToken = () => randomBytes(16).toString('hex');

// ---------------------------------------------------------------- audiences
export interface Audience { id: string; name: string; created_ms: string | null; count?: number; }

export async function listAudiences(): Promise<Audience[]> {
  const rows = await q<Audience>('SELECT id, name, created_ms FROM audiences ORDER BY id DESC');
  for (const a of rows) {
    const c = await q<{ c: string }>(
      "SELECT count(*)::bigint AS c FROM contacts WHERE audience_id=$1::bigint AND status='subscribed'",
      [a.id],
    );
    a.count = Number(c[0]?.c ?? 0);
  }
  return rows;
}

export async function createAudience(name: string): Promise<Audience> {
  const r = await q<Audience>(
    'INSERT INTO audiences(name, created_ms) VALUES ($1, $2::bigint) RETURNING id, name, created_ms',
    [name, now()],
  );
  return r[0];
}

export async function getAudience(id: string): Promise<Audience | null> {
  const r = await q<Audience>('SELECT id, name, created_ms FROM audiences WHERE id=$1::bigint', [id]);
  return r[0] ?? null;
}

// ----------------------------------------------------------------- contacts
export interface Contact {
  id: string; audience_id: string; email: string;
  first_name: string | null; last_name: string | null; company: string | null;
  fields: Record<string, string> | null; status: string; token: string; created_ms: string | null;
}

export async function listContacts(audienceId: string, limit = 500): Promise<Contact[]> {
  return q<Contact>(
    `SELECT id, audience_id, email, first_name, last_name, company, fields, status, token, created_ms
     FROM contacts WHERE audience_id=$1::bigint ORDER BY id DESC LIMIT $2`,
    [audienceId, limit],
  );
}

export async function findContact(audienceId: string, email: string): Promise<Contact | null> {
  const r = await q<Contact>(
    `SELECT id, audience_id, email, first_name, last_name, company, fields, status, token, created_ms
     FROM contacts WHERE audience_id=$1::bigint AND email=$2 LIMIT 1`,
    [audienceId, email.toLowerCase()],
  );
  return r[0] ?? null;
}

export async function getContactByToken(token: string): Promise<Contact | null> {
  const r = await q<Contact>(
    `SELECT id, audience_id, email, first_name, last_name, company, fields, status, token, created_ms
     FROM contacts WHERE token=$1 LIMIT 1`,
    [token],
  );
  return r[0] ?? null;
}

export interface UpsertContact {
  email: string; first_name?: string; last_name?: string; company?: string;
  fields?: Record<string, string>;
}

/** Insert or update a contact by (audience, email). Returns [contact, created?]. */
export async function upsertContact(
  audienceId: string, c: UpsertContact,
): Promise<{ contact: Contact; created: boolean }> {
  const email = c.email.trim().toLowerCase();
  const existing = await findContact(audienceId, email);
  if (existing) {
    const r = await q<Contact>(
      `UPDATE contacts SET first_name=$2, last_name=$3, company=$4, fields=$5::jsonb
       WHERE id=$1::bigint
       RETURNING id, audience_id, email, first_name, last_name, company, fields, status, token, created_ms`,
      [existing.id, c.first_name ?? existing.first_name, c.last_name ?? existing.last_name,
       c.company ?? existing.company, JSON.stringify(c.fields ?? existing.fields ?? {})],
    );
    return { contact: r[0], created: false };
  }
  const r = await q<Contact>(
    `INSERT INTO contacts(audience_id, email, first_name, last_name, company, fields, status, token, created_ms)
     VALUES ($1::bigint, $2, $3, $4, $5, $6::jsonb, 'subscribed', $7, $8::bigint)
     RETURNING id, audience_id, email, first_name, last_name, company, fields, status, token, created_ms`,
    [audienceId, email, c.first_name ?? null, c.last_name ?? null, c.company ?? null,
     JSON.stringify(c.fields ?? {}), newToken(), now()],
  );
  return { contact: r[0], created: true };
}

export async function setContactStatus(id: string, status: string): Promise<void> {
  await q('UPDATE contacts SET status=$2 WHERE id=$1::bigint', [id, status]);
}

export async function subscribedContacts(audienceId: string): Promise<Contact[]> {
  return q<Contact>(
    `SELECT id, audience_id, email, first_name, last_name, company, fields, status, token, created_ms
     FROM contacts WHERE audience_id=$1::bigint AND status='subscribed' ORDER BY id`,
    [audienceId],
  );
}

// ---------------------------------------------------------------- templates
export interface Block { type: 'heading' | 'text' | 'button' | 'image' | 'divider'; [k: string]: unknown; }
export interface Template {
  id: string; name: string; subject: string | null;
  blocks: Block[] | null; html: string | null; updated_ms: string | null;
}

export async function listTemplates(): Promise<Template[]> {
  return q<Template>('SELECT id, name, subject, blocks, html, updated_ms FROM templates ORDER BY id DESC');
}
export async function getTemplate(id: string): Promise<Template | null> {
  const r = await q<Template>('SELECT id, name, subject, blocks, html, updated_ms FROM templates WHERE id=$1::bigint', [id]);
  return r[0] ?? null;
}
export async function createTemplate(name: string, subject: string, blocks: Block[], html: string): Promise<Template> {
  const r = await q<Template>(
    `INSERT INTO templates(name, subject, blocks, html, updated_ms)
     VALUES ($1,$2,$3::jsonb,$4,$5::bigint) RETURNING id, name, subject, blocks, html, updated_ms`,
    [name, subject, JSON.stringify(blocks), html, now()],
  );
  return r[0];
}
export async function updateTemplate(id: string, name: string, subject: string, blocks: Block[], html: string): Promise<void> {
  await q('UPDATE templates SET name=$2, subject=$3, blocks=$4::jsonb, html=$5, updated_ms=$6::bigint WHERE id=$1::bigint',
    [id, name, subject, JSON.stringify(blocks), html, now()]);
}

// ---------------------------------------------------------------- campaigns
export interface Campaign {
  id: string; name: string; audience_id: string | null; template_id: string | null;
  subject: string | null; html: string | null; status: string;
  scheduled_ms: string | null; sent_ms: string | null;
  total: string | null; sent_count: string | null; created_ms: string | null;
}

export async function listCampaigns(): Promise<Campaign[]> {
  return q<Campaign>(
    `SELECT id, name, audience_id, template_id, subject, html, status,
            scheduled_ms, sent_ms, total, sent_count, created_ms
     FROM campaigns ORDER BY id DESC`);
}
export async function getCampaign(id: string): Promise<Campaign | null> {
  const r = await q<Campaign>(
    `SELECT id, name, audience_id, template_id, subject, html, status,
            scheduled_ms, sent_ms, total, sent_count, created_ms
     FROM campaigns WHERE id=$1::bigint`, [id]);
  return r[0] ?? null;
}
export async function createCampaign(
  name: string, audienceId: string, templateId: string, subject: string, html: string,
): Promise<Campaign> {
  const r = await q<Campaign>(
    `INSERT INTO campaigns(name, audience_id, template_id, subject, html, status, created_ms)
     VALUES ($1,$2::bigint,$3::bigint,$4,$5,'draft',$6::bigint)
     RETURNING id, name, audience_id, template_id, subject, html, status,
               scheduled_ms, sent_ms, total, sent_count, created_ms`,
    [name, audienceId, templateId, subject, html, now()]);
  return r[0];
}
export async function updateCampaignStatus(
  id: string, status: string, extra: Partial<{ scheduled_ms: number; sent_ms: number; total: number; sent_count: number }> = {},
): Promise<void> {
  const sets = ['status=$2'];
  const params: unknown[] = [id, status];
  let i = 3;
  for (const [k, v] of Object.entries(extra)) {
    sets.push(`${k}=$${i}::bigint`); params.push(v); i++;
  }
  await q(`UPDATE campaigns SET ${sets.join(', ')} WHERE id=$1::bigint`, params);
}
export async function dueCampaigns(nowMs: number): Promise<Campaign[]> {
  return q<Campaign>(
    `SELECT id, name, audience_id, template_id, subject, html, status,
            scheduled_ms, sent_ms, total, sent_count, created_ms
     FROM campaigns WHERE status='scheduled' AND scheduled_ms <= $1::bigint`, [nowMs]);
}

// ------------------------------------------------------------------- events
export async function recordEvent(
  campaignId: string, contactId: string | null, email: string, kind: string, url: string | null,
): Promise<void> {
  await q(
    `INSERT INTO events(campaign_id, contact_id, email, kind, url, ts_ms)
     VALUES ($1::bigint,$2,$3,$4,$5,$6::bigint)`,
    [campaignId, contactId, email, kind, url, now()]);
}

/** Per-campaign stats via scalar COUNTs (GROUP BY returns null on SynergyDB). */
export async function campaignStats(campaignId: string) {
  const one = async (where: string) => {
    const r = await q<{ c: string }>(
      `SELECT count(*)::bigint AS c FROM events WHERE campaign_id=$1::bigint AND ${where}`, [campaignId]);
    return Number(r[0]?.c ?? 0);
  };
  const uniq = async (kind: string) => {
    // SynergyDB: SELECT DISTINCT corrupts the wire response, so dedupe app-side.
    const rows = await q<{ contact_id: string }>(
      `SELECT contact_id FROM events WHERE campaign_id=$1::bigint AND kind=$2`, [campaignId, kind]);
    return new Set(rows.map((r) => r.contact_id).filter((v) => v != null)).size;
  };
  return {
    sends: await one("kind='send'"),
    opens: await one("kind='open'"),
    uniqueOpens: await uniq('open'),
    clicks: await one("kind='click'"),
    uniqueClicks: await uniq('click'),
    unsubs: await one("kind='unsub'"),
  };
}

export async function recentEvents(campaignId: string, limit = 50) {
  return q(
    `SELECT kind, email, url, ts_ms FROM events
     WHERE campaign_id=$1::bigint ORDER BY id DESC LIMIT $2`, [campaignId, limit]);
}

// --------------------------------------------------------------- automations
export interface Automation {
  id: string; name: string; trigger: string; audience_id: string | null;
  template_id: string | null; delay_min: string | null; active: boolean; created_ms: string | null;
}
export async function listAutomations(): Promise<Automation[]> {
  return q<Automation>(
    'SELECT id, name, trigger, audience_id, template_id, delay_min, active, created_ms FROM automations ORDER BY id DESC');
}
export async function createAutomation(
  name: string, trigger: string, audienceId: string, templateId: string, delayMin: number,
): Promise<Automation> {
  const r = await q<Automation>(
    `INSERT INTO automations(name, trigger, audience_id, template_id, delay_min, active, created_ms)
     VALUES ($1,$2,$3::bigint,$4::bigint,$5::bigint,true,$6::bigint)
     RETURNING id, name, trigger, audience_id, template_id, delay_min, active, created_ms`,
    [name, trigger, audienceId, templateId, delayMin, now()]);
  return r[0];
}
export async function activeAutomationsFor(audienceId: string): Promise<Automation[]> {
  return q<Automation>(
    `SELECT id, name, trigger, audience_id, template_id, delay_min, active, created_ms
     FROM automations WHERE audience_id=$1::bigint AND active=true AND trigger='contact_added'`,
    [audienceId]);
}
export async function scheduleAutomationRun(automationId: string, contactId: string, dueMs: number): Promise<void> {
  await q('INSERT INTO automation_runs(automation_id, contact_id, due_ms) VALUES ($1::bigint,$2::bigint,$3::bigint)',
    [automationId, contactId, dueMs]);
}
export async function dueAutomationRuns(nowMs: number) {
  return q<{ id: string; automation_id: string; contact_id: string }>(
    `SELECT id, automation_id, contact_id FROM automation_runs
     WHERE done_ms IS NULL AND due_ms <= $1::bigint LIMIT 100`, [nowMs]);
}
export async function markAutomationRunDone(id: string): Promise<void> {
  await q('UPDATE automation_runs SET done_ms=$2::bigint WHERE id=$1::bigint', [id, now()]);
}
