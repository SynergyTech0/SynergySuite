import { NextResponse } from 'next/server';
import {
  dueCampaigns, dueAutomationRuns, markAutomationRunDone,
  getTemplate, getContactByToken, now,
} from '@/lib/repo';
import { q } from '@/lib/db';
import { sendCampaign, sendOneOff } from '@/lib/send';
import type { Contact } from '@/lib/repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Scheduler tick: fire due scheduled campaigns + due automation runs. Call periodically. */
async function tick() {
  const t = now();
  const firedCampaigns: string[] = [];
  for (const c of await dueCampaigns(t)) {
    try { await sendCampaign(c.id); firedCampaigns.push(c.id); }
    catch (e) { /* status set to failed inside send path caller */ }
  }

  let automationSends = 0;
  for (const run of await dueAutomationRuns(t)) {
    const auto = (await q<any>('SELECT template_id FROM automations WHERE id=$1::bigint', [run.automation_id]))[0];
    const contact = (await q<Contact>(
      `SELECT id, audience_id, email, first_name, last_name, company, fields, status, token, created_ms
       FROM contacts WHERE id=$1::bigint`, [run.contact_id]))[0];
    if (auto && contact && contact.status === 'subscribed') {
      const tpl = await getTemplate(auto.template_id);
      if (tpl) {
        try {
          await sendOneOff(`auto-${run.automation_id}-${run.contact_id}`, tpl.subject ?? '', tpl.html ?? '', [contact]);
          automationSends++;
        } catch { /* leave run; will retry next tick unless marked done below */ }
      }
    }
    await markAutomationRunDone(run.id);
  }
  return { firedCampaigns, automationSends };
}

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured -> allow (dev)
  const url = new URL(req.url);
  return url.searchParams.get('secret') === secret ||
    req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await tick());
}
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await tick());
}
