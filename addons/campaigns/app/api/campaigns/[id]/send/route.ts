import { NextResponse } from 'next/server';
import { sendCampaign } from '@/lib/send';
import { getCampaign, updateCampaignStatus } from '@/lib/repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { dryRun, scheduleMs } = body as { dryRun?: boolean; scheduleMs?: number };

  const camp = await getCampaign(id);
  if (!camp) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // schedule for later — the /api/cron tick will fire it
  if (scheduleMs && scheduleMs > Date.now()) {
    await updateCampaignStatus(id, 'scheduled', { scheduled_ms: scheduleMs });
    return NextResponse.json({ scheduled: true, at: scheduleMs });
  }

  try {
    const result = await sendCampaign(id, { dryRun: !!dryRun });
    return NextResponse.json({ ok: true, dryRun: !!dryRun, ...result });
  } catch (e: any) {
    if (!dryRun) await updateCampaignStatus(id, 'failed');
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
