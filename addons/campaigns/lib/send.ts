import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { injectTracking } from './render';
import {
  getCampaign, getAudience, subscribedContacts, recordEvent,
  updateCampaignStatus, type Contact,
} from './repo';

const env = (k: string, d = '') => process.env[k] ?? d;
const tomlStr = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function contactRow(c: Contact): Record<string, string> {
  const base: Record<string, string> = {
    email: c.email,
    first_name: c.first_name ?? '',
    last_name: c.last_name ?? '',
    company: c.company ?? '',
    track_token: c.token,
  };
  for (const [k, v] of Object.entries(c.fields ?? {})) {
    if (!(k in base)) base[k] = String(v ?? '');
  }
  return base;
}

/** Naive HTML -> text fallback for the multipart text/plain part. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|tr|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .trim();
}

export interface SendResult { sent: number; failed: number; total: number; log: string; }

/**
 * Send (or test-send) a campaign by driving the Python mailer.
 * If dryRun, the mailer is invoked with --dry-run and nothing leaves the box.
 */
export async function sendCampaign(campaignId: string, opts: { dryRun?: boolean } = {}): Promise<SendResult> {
  const camp = await getCampaign(campaignId);
  if (!camp) throw new Error('campaign not found');
  if (!camp.audience_id) throw new Error('campaign has no audience');
  const audience = await getAudience(camp.audience_id);
  if (!audience) throw new Error('audience not found');

  const contacts = await subscribedContacts(camp.audience_id);
  const baseUrl = env('PUBLIC_BASE_URL', 'http://localhost:3400');

  const html = injectTracking(camp.html ?? '', baseUrl, campaignId);
  const text = htmlToText(camp.html ?? '') +
    '\n\n{{track_token}}'.replace('{{track_token}}', ''); // text part carries no pixel

  // working dir per campaign
  const work = path.join(os.tmpdir(), 'synergymail', `campaign-${campaignId}`);
  await mkdir(path.join(work, 'templates'), { recursive: true });
  await writeFile(path.join(work, 'templates', 'body.html'), html, 'utf8');
  await writeFile(path.join(work, 'templates', 'body.txt'), text, 'utf8');

  // recipients.csv (union of all field keys as header)
  const rows = contacts.map(contactRow);
  const headers = Array.from(rows.reduce((set, r) => {
    Object.keys(r).forEach((k) => set.add(k));
    return set;
  }, new Set<string>(['email', 'first_name', 'last_name', 'company', 'track_token'])));
  const csv = [headers.join(',')]
    .concat(rows.map((r) => headers.map((h) => csvCell(r[h] ?? '')).join(',')))
    .join('\n');
  await writeFile(path.join(work, 'recipients.csv'), csv, 'utf8');

  // config.toml for the mailer
  const cfg = `
[smtp]
host = ${tomlStr(env('MAILER_SMTP_HOST', 'localhost'))}
port = ${Number(env('MAILER_SMTP_PORT', '587'))}
username = ${tomlStr(env('MAILER_SMTP_USERNAME'))}
security = ${tomlStr(env('MAILER_SMTP_SECURITY', 'starttls'))}
timeout = 30

[campaign]
from_name  = ${tomlStr(env('MAILER_FROM_NAME'))}
from_email = ${tomlStr(env('MAILER_FROM_EMAIL', 'noreply@example.com'))}
reply_to   = ${tomlStr(env('MAILER_REPLY_TO'))}
subject    = ${tomlStr(camp.subject ?? '')}
html_template = "templates/body.html"
text_template = "templates/body.txt"
recipients    = "recipients.csv"
email_column  = "email"

[compliance]
org_name       = ${tomlStr(env('MAILER_ORG_NAME'))}
postal_address = ${tomlStr(env('MAILER_POSTAL_ADDRESS'))}
unsubscribe_url    = ${tomlStr(`${baseUrl.replace(/\/$/, '')}/u/${campaignId}`)}
unsubscribe_mailto = ${tomlStr(env('MAILER_REPLY_TO', env('MAILER_FROM_EMAIL')))}

[throttle]
per_minute = ${Number(env('MAILER_PER_MINUTE', '30'))}

[files]
suppression = "suppression.txt"
sent_log    = "sent.log"
`.trimStart();
  await writeFile(path.join(work, 'config.toml'), cfg, 'utf8');

  // record 'send' events up front (one per queued contact) unless dry run
  if (!opts.dryRun) {
    await updateCampaignStatus(campaignId, 'sending', { total: contacts.length });
    for (const c of contacts) await recordEvent(campaignId, c.id, c.email, 'send', null);
  }

  const mailer = path.join(env('MAILER_DIR', 'C:\\Users\\shane\\email-mailer'), 'mailer.py');
  const args = ['send', '--config', 'config.toml'];
  if (opts.dryRun) args.push('--dry-run');

  const result = await runMailer(mailer, args, work);
  const sent = countMatches(result, /\]\s*OK\s+/g);
  const failed = countMatches(result, /\]\s*FAIL\s+/g);

  if (!opts.dryRun) {
    await updateCampaignStatus(campaignId, 'sent', { sent_ms: Date.now(), sent_count: sent });
  }
  return { sent, failed, total: contacts.length, log: result };
}

function countMatches(s: string, re: RegExp): number {
  return (s.match(re) ?? []).length;
}

/**
 * Fire a single template to one or more contacts (used by automations).
 * No open/click tracking — just delivery via the mailer.
 */
export async function sendOneOff(
  label: string, subject: string, html: string, contacts: Contact[], opts: { dryRun?: boolean } = {},
): Promise<SendResult> {
  const work = path.join(os.tmpdir(), 'synergymail', `oneoff-${label}`);
  await mkdir(path.join(work, 'templates'), { recursive: true });
  await writeFile(path.join(work, 'templates', 'body.html'), html, 'utf8');
  await writeFile(path.join(work, 'templates', 'body.txt'), htmlToText(html), 'utf8');

  const rows = contacts.map(contactRow);
  const headers = ['email', 'first_name', 'last_name', 'company', 'track_token'];
  const csv = [headers.join(',')]
    .concat(rows.map((r) => headers.map((h) => csvCell(r[h] ?? '')).join(',')))
    .join('\n');
  await writeFile(path.join(work, 'recipients.csv'), csv, 'utf8');

  const baseUrl = env('PUBLIC_BASE_URL', 'http://localhost:3400');
  const cfg = `
[smtp]
host = ${tomlStr(env('MAILER_SMTP_HOST', 'localhost'))}
port = ${Number(env('MAILER_SMTP_PORT', '587'))}
username = ${tomlStr(env('MAILER_SMTP_USERNAME'))}
security = ${tomlStr(env('MAILER_SMTP_SECURITY', 'starttls'))}

[campaign]
from_name  = ${tomlStr(env('MAILER_FROM_NAME'))}
from_email = ${tomlStr(env('MAILER_FROM_EMAIL', 'noreply@example.com'))}
reply_to   = ${tomlStr(env('MAILER_REPLY_TO'))}
subject    = ${tomlStr(subject)}
html_template = "templates/body.html"
text_template = "templates/body.txt"
recipients    = "recipients.csv"
email_column  = "email"

[compliance]
org_name       = ${tomlStr(env('MAILER_ORG_NAME'))}
postal_address = ${tomlStr(env('MAILER_POSTAL_ADDRESS'))}
unsubscribe_mailto = ${tomlStr(env('MAILER_REPLY_TO', env('MAILER_FROM_EMAIL')))}

[throttle]
per_minute = ${Number(env('MAILER_PER_MINUTE', '30'))}

[files]
suppression = "suppression.txt"
sent_log    = "sent.log"
`.trimStart();
  await writeFile(path.join(work, 'config.toml'), cfg, 'utf8');

  const mailer = path.join(env('MAILER_DIR', 'C:\\Users\\shane\\email-mailer'), 'mailer.py');
  const args = ['send', '--config', 'config.toml'];
  if (opts.dryRun) args.push('--dry-run');
  const out = await runMailer(mailer, args, work);
  return { sent: countMatches(out, /\]\s*OK\s+/g), failed: countMatches(out, /\]\s*FAIL\s+/g), total: contacts.length, log: out };
}

function runMailer(script: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const py = env('PYTHON_BIN', 'python');
    const child = spawn(py, [script, ...args], {
      cwd,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`mailer exited ${code}\n${out}`));
    });
  });
}
